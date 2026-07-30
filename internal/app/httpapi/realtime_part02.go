package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kannachi323/misty/server/internal/platform/security"
)

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
			log.Printf("Realtime WebSocket replay failed for user %s after %d: %v", userID, after, err)
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

// ConnectionCount reports how many realtime WebSockets are currently held.
//
// These connections are long-lived, so an edge proxy sees only the upgrade and
// never how many are still open. This is the only place that number exists.
func (s *RealtimeService) ConnectionCount() int {
	if s == nil {
		return 0
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.clients)
}
