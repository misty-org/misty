package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kannachi323/misty/server/db"
	"github.com/kannachi323/misty/server/security"
	"github.com/lib/pq"
)

const (
	realtimeWriteWait  = 10 * time.Second
	realtimePongWait   = 90 * time.Second
	realtimePingPeriod = 30 * time.Second
)

type realtimeClient struct {
	userID string
	conn   *websocket.Conn
	send   chan []byte
	done   chan struct{}
	once   sync.Once
}

type RealtimeService struct {
	database  *db.Database
	dsn       string
	listener  *pq.Listener
	mu        sync.RWMutex
	clients   map[*realtimeClient]struct{}
	closed    chan struct{}
	closeOnce sync.Once
}

func NewRealtimeService(database *db.Database, dsn string) *RealtimeService {
	return &RealtimeService{database: database, dsn: dsn, clients: map[*realtimeClient]struct{}{}, closed: make(chan struct{})}
}

func (s *RealtimeService) Start() error {
	if s.dsn == "" {
		return errors.New("database DSN is required for realtime")
	}
	s.listener = pq.NewListener(s.dsn, time.Second, 30*time.Second, nil)
	if err := s.listener.Listen("misty_space_events"); err != nil {
		return err
	}
	if err := s.listener.Listen("misty_space_control"); err != nil {
		return err
	}
	if err := s.listener.Ping(); err != nil {
		return err
	}
	go s.listen()
	return nil
}

func (s *RealtimeService) Close() error {
	var err error
	s.closeOnce.Do(func() {
		close(s.closed)
		if s.listener != nil {
			err = s.listener.Close()
		}
		s.mu.Lock()
		for client := range s.clients {
			_ = client.conn.Close()
		}
		s.clients = map[*realtimeClient]struct{}{}
		s.mu.Unlock()
	})
	return err
}

func (s *RealtimeService) listen() {
	for {
		select {
		case <-s.closed:
			return
		case notification, ok := <-s.listener.Notify:
			if !ok {
				return
			}
			if notification == nil {
				continue
			}
			if notification.Channel == "misty_space_control" {
				s.broadcastControl([]byte(notification.Extra))
			} else {
				eventID, err := strconv.ParseInt(notification.Extra, 10, 64)
				if err == nil {
					s.BroadcastEvent(eventID)
				}
			}
		case <-time.After(45 * time.Second):
			go s.listener.Ping()
		}
	}
}

func (s *RealtimeService) broadcastControl(payload []byte) {
	var control struct {
		Type    string   `json:"type"`
		SpaceID string   `json:"space_id"`
		UserIDs []string `json:"user_ids"`
	}
	if json.Unmarshal(payload, &control) != nil {
		return
	}
	affected := map[string]bool{}
	for _, userID := range control.UserIDs {
		affected[userID] = true
	}
	envelope, _ := json.Marshal(map[string]any{"type": "control", "action": control.Type, "space_id": control.SpaceID})
	s.mu.RLock()
	clients := make([]*realtimeClient, 0)
	for client := range s.clients {
		if affected[client.userID] {
			clients = append(clients, client)
		}
	}
	s.mu.RUnlock()
	for _, client := range clients {
		select {
		case client.send <- envelope:
		default:
		}
		go func(target *realtimeClient) {
			timer := time.NewTimer(150 * time.Millisecond)
			defer timer.Stop()
			select {
			case <-timer.C:
			case <-target.done:
				return
			}
			_ = target.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "Space access changed"), time.Now().Add(time.Second))
			_ = target.conn.Close()
			s.unregister(target)
		}(client)
	}
}

func (s *RealtimeService) BroadcastEvent(eventID int64) {
	s.mu.RLock()
	clients := make([]*realtimeClient, 0, len(s.clients))
	for client := range s.clients {
		clients = append(clients, client)
	}
	s.mu.RUnlock()
	for _, client := range clients {
		event, err := s.database.EventByIDForUser(context.Background(), client.userID, eventID)
		if err != nil {
			continue
		}
		payload, err := json.Marshal(map[string]any{"type": "event", "event": event})
		if err != nil {
			continue
		}
		select {
		case client.send <- payload:
		default:
			_ = client.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1013, "reconnect and resync"), time.Now().Add(time.Second))
			_ = client.conn.Close()
			s.unregister(client)
		}
	}
}

func (s *RealtimeService) Ticket() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			After int64 `json:"after"`
		}
		if r.ContentLength > 0 && decodeJSON(w, r, &body) != nil {
			return
		}
		token, hash, err := randomToken()
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if err := s.database.CreateRealtimeTicket(r.Context(), userID, hash, body.After, time.Now().UTC().Add(60*time.Second)); err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"ticket": token, "expires_in": 60})
	}
}

var realtimeUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(_ *http.Request) bool { return true }, // Single-use authenticated ticket is the CSRF boundary.
}

func (s *RealtimeService) Connect() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("ticket")
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "invalid_ticket"})
			return
		}
		userID, after, err := s.database.ConsumeRealtimeTicket(r.Context(), security.HashToken(token))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		conn, err := realtimeUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		client := &realtimeClient{userID: userID, conn: conn, send: make(chan []byte, 256), done: make(chan struct{})}
		events, resync, err := s.database.SpaceEventsAfter(r.Context(), userID, after, 500)
		if err != nil {
			_ = conn.Close()
			return
		}
		initial, _ := json.Marshal(map[string]any{"type": "replay", "events": events, "resync_required": resync})
		if err := conn.WriteMessage(websocket.TextMessage, initial); err != nil {
			_ = conn.Close()
			return
		}
		s.register(client)
		go s.writeLoop(client)
		s.readLoop(client)
	}
}

func (s *RealtimeService) register(client *realtimeClient) {
	s.mu.Lock()
	s.clients[client] = struct{}{}
	s.mu.Unlock()
}

func (s *RealtimeService) unregister(client *realtimeClient) {
	s.mu.Lock()
	if _, ok := s.clients[client]; ok {
		delete(s.clients, client)
		client.once.Do(func() { close(client.done) })
	}
	s.mu.Unlock()
}

func (s *RealtimeService) readLoop(client *realtimeClient) {
	defer func() { s.unregister(client); _ = client.conn.Close() }()
	client.conn.SetReadLimit(4096)
	_ = client.conn.SetReadDeadline(time.Now().Add(realtimePongWait))
	client.conn.SetPongHandler(func(string) error { return client.conn.SetReadDeadline(time.Now().Add(realtimePongWait)) })
	for {
		if _, _, err := client.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (s *RealtimeService) writeLoop(client *realtimeClient) {
	ticker := time.NewTicker(realtimePingPeriod)
	defer ticker.Stop()
	for {
		select {
		case payload := <-client.send:
			_ = client.conn.SetWriteDeadline(time.Now().Add(realtimeWriteWait))
			if err := client.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		case <-ticker.C:
			_ = client.conn.SetWriteDeadline(time.Now().Add(realtimeWriteWait))
			if err := client.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-s.closed:
			return
		case <-client.done:
			return
		}
	}
}
