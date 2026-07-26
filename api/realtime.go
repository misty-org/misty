package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sort"
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
	// viewingSpaceID is the space this client last told us it's actively
	// viewing (empty when not viewing any space's chat). Mutated only while
	// holding RealtimeService.mu.
	viewingSpaceID string
	// active is whether the client reported having this space's chat in
	// focus (vs. connected but idle — e.g. tabbed away). Only meaningful
	// while viewingSpaceID is non-empty. Mutated only while holding
	// RealtimeService.mu.
	active bool
}

type RealtimeService struct {
	database *db.Database
	dsn      string
	listener *pq.Listener
	mu       sync.RWMutex
	clients  map[*realtimeClient]struct{}
	// viewers maps a space ID to the set of clients currently viewing that
	// space's chat, for the "active users" presence capsule. Guarded by mu.
	viewers   map[string]map[*realtimeClient]struct{}
	closed    chan struct{}
	closeOnce sync.Once
}

func NewRealtimeService(database *db.Database, dsn string) *RealtimeService {
	return &RealtimeService{
		database: database,
		dsn:      dsn,
		clients:  map[*realtimeClient]struct{}{},
		viewers:  map[string]map[*realtimeClient]struct{}{},
		closed:   make(chan struct{}),
	}
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
		s.viewers = map[string]map[*realtimeClient]struct{}{}
		s.mu.Unlock()
	})
	return err
}

func (s *RealtimeService) Health() error {
	if s == nil || s.listener == nil {
		return errors.New("realtime listener is not started")
	}
	return s.listener.Ping()
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
		NoteID  string   `json:"note_id"`
		// KeepConnection marks a control message that revokes access to one
		// resource rather than to the whole Space. Losing a note grant must not
		// tear down the connection: the user is still a Space member and still
		// needs chat, tasks, and Library events.
		KeepConnection bool `json:"keep_connection"`
	}
	if json.Unmarshal(payload, &control) != nil {
		return
	}
	affected := map[string]bool{}
	for _, userID := range control.UserIDs {
		affected[userID] = true
	}
	envelopeFields := map[string]any{"type": "control", "action": control.Type, "space_id": control.SpaceID}
	if control.NoteID != "" {
		envelopeFields["note_id"] = control.NoteID
	}
	envelope, _ := json.Marshal(envelopeFields)
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
		if control.KeepConnection {
			continue
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
		// Check the upgrade before consuming the single-use ticket. A reverse
		// proxy that drops the Upgrade headers must not invalidate a valid ticket.
		if !websocket.IsWebSocketUpgrade(r) {
			log.Printf("Realtime WebSocket upgrade headers missing")
			w.Header().Set("Upgrade", "websocket")
			writeJSON(w, http.StatusUpgradeRequired, map[string]string{"code": "websocket_upgrade_required"})
			return
		}
		token := r.URL.Query().Get("ticket")
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "invalid_ticket"})
			return
		}
		userID, after, err := s.database.ConsumeRealtimeTicket(r.Context(), security.HashToken(token))
		if err != nil {
			log.Printf("Realtime WebSocket ticket rejected: %v", err)
			writeSpaceError(w, err)
			return
		}
		conn, err := realtimeUpgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("Realtime WebSocket upgrade failed: %v", err)
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
	previousSpaceID := client.viewingSpaceID
	if previousSpaceID != "" {
		s.removeViewerLocked(previousSpaceID, client)
		client.viewingSpaceID = ""
	}
	s.mu.Unlock()
	if previousSpaceID != "" {
		s.broadcastPresence(previousSpaceID)
	}
}

// removeViewerLocked removes client from spaceID's viewer set. Callers must
// hold s.mu.
func (s *RealtimeService) removeViewerLocked(spaceID string, client *realtimeClient) {
	viewers := s.viewers[spaceID]
	if viewers == nil {
		return
	}
	delete(viewers, client)
	if len(viewers) == 0 {
		delete(s.viewers, spaceID)
	}
}

// handleClientMessage processes a message sent by a connected client. The
// only message clients currently send is a "viewing" declaration, used to
// drive the per-Space "active users" presence capsule. It carries an
// "active" flag distinguishing a client that has the space's chat in focus
// from one that's merely still connected while viewing something else
// (idle).
func (s *RealtimeService) handleClientMessage(client *realtimeClient, payload []byte) {
	var msg struct {
		Type    string `json:"type"`
		SpaceID string `json:"space_id"`
		Active  bool   `json:"active"`
	}
	if json.Unmarshal(payload, &msg) != nil {
		return
	}
	if msg.Type == "viewing" {
		s.setViewing(client, msg.SpaceID, msg.Active)
	}
}

// setViewing updates which space (if any) a client is actively viewing, and
// whether it currently has that space's chat in focus, then broadcasts the
// resulting presence change. A non-empty spaceID is verified against real
// space membership before being accepted — otherwise a client could claim to
// be viewing a space it has no access to and leak its presence to that
// space's real members.
func (s *RealtimeService) setViewing(client *realtimeClient, spaceID string, active bool) {
	if spaceID != "" {
		isMember, err := s.database.IsSpaceMember(context.Background(), client.userID, spaceID)
		if err != nil || !isMember {
			spaceID = ""
		}
	}

	s.mu.Lock()
	previous := client.viewingSpaceID
	if previous == spaceID && client.active == active {
		s.mu.Unlock()
		return
	}
	spaceChanged := previous != spaceID
	if spaceChanged && previous != "" {
		s.removeViewerLocked(previous, client)
	}
	if spaceID != "" {
		if s.viewers[spaceID] == nil {
			s.viewers[spaceID] = map[*realtimeClient]struct{}{}
		}
		s.viewers[spaceID][client] = struct{}{}
	}
	client.viewingSpaceID = spaceID
	client.active = active
	s.mu.Unlock()

	if spaceChanged && previous != "" {
		s.broadcastPresence(previous)
	}
	if spaceID != "" {
		s.broadcastPresence(spaceID)
	}
}

// presenceViewer describes one distinct user viewing a space, and whether
// any of their connections currently has that space's chat in focus.
type presenceViewer struct {
	UserID string `json:"user_id"`
	Active bool   `json:"active"`
}

// broadcastPresence sends the current list of distinct users viewing spaceID
// (and their active/idle status) to every client currently viewing it. A
// user with multiple connections (e.g. two tabs) counts as active if any one
// of them has the space in focus.
func (s *RealtimeService) broadcastPresence(spaceID string) {
	s.mu.RLock()
	viewers := s.viewers[spaceID]
	targets := make([]*realtimeClient, 0, len(viewers))
	activeByUser := map[string]bool{}
	for client := range viewers {
		targets = append(targets, client)
		activeByUser[client.userID] = activeByUser[client.userID] || client.active
	}
	s.mu.RUnlock()

	userIDs := make([]string, 0, len(activeByUser))
	for userID := range activeByUser {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	presenceViewers := make([]presenceViewer, 0, len(userIDs))
	for _, userID := range userIDs {
		presenceViewers = append(presenceViewers, presenceViewer{UserID: userID, Active: activeByUser[userID]})
	}

	payload, err := json.Marshal(map[string]any{
		"type":     "presence",
		"space_id": spaceID,
		"viewers":  presenceViewers,
	})
	if err != nil {
		return
	}
	for _, client := range targets {
		select {
		case client.send <- payload:
		default:
		}
	}
}

func (s *RealtimeService) readLoop(client *realtimeClient) {
	defer func() { s.unregister(client); _ = client.conn.Close() }()
	client.conn.SetReadLimit(4096)
	_ = client.conn.SetReadDeadline(time.Now().Add(realtimePongWait))
	client.conn.SetPongHandler(func(string) error { return client.conn.SetReadDeadline(time.Now().Add(realtimePongWait)) })
	for {
		_, payload, err := client.conn.ReadMessage()
		if err != nil {
			return
		}
		s.handleClientMessage(client, payload)
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
