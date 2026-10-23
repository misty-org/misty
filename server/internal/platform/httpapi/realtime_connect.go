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
		client := &RealtimeClient{UserID: userID, conn: conn, Send: make(chan []byte, 256), Done: make(chan struct{})}
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

func (s *RealtimeService) register(client *RealtimeClient) {
	s.Mu.Lock()
	s.clients[client] = struct{}{}
	if s.clientsByUser[client.UserID] == nil {
		s.clientsByUser[client.UserID] = map[*RealtimeClient]struct{}{}
	}
	s.clientsByUser[client.UserID][client] = struct{}{}
	s.Mu.Unlock()
}

func (s *RealtimeService) Unregister(client *RealtimeClient) {
	s.Mu.Lock()
	if _, ok := s.clients[client]; ok {
		delete(s.clients, client)
		delete(s.clientsByUser[client.UserID], client)
		if len(s.clientsByUser[client.UserID]) == 0 {
			delete(s.clientsByUser, client.UserID)
		}
		client.once.Do(func() { close(client.Done) })
	}
	previousSpaceID := client.viewingSpaceID
	if previousSpaceID != "" {
		s.removeViewerLocked(previousSpaceID, client)
		client.viewingSpaceID = ""
	}
	s.Mu.Unlock()
	if previousSpaceID != "" {
		s.broadcastPresence(previousSpaceID)
	}
}

// removeViewerLocked removes client from spaceID's viewer set. Callers must
// hold s.mu.
func (s *RealtimeService) removeViewerLocked(spaceID string, client *RealtimeClient) {
	viewers := s.Viewers[spaceID]
	if viewers == nil {
		return
	}
	delete(viewers, client)
	if len(viewers) == 0 {
		delete(s.Viewers, spaceID)
	}
}

// handleClientMessage processes a message sent by a connected client. The
// only message clients currently send is a "viewing" declaration, used to
// drive the per-Space "active users" presence capsule. It carries an
// "active" flag distinguishing a client that has the space's chat in focus
// from one that's merely still connected while viewing something else
// (idle).
func (s *RealtimeService) handleClientMessage(client *RealtimeClient, payload []byte) {
	var msg struct {
		Type    string `json:"type"`
		SpaceID string `json:"space_id"`
		Active  bool   `json:"active"`
	}
	if json.Unmarshal(payload, &msg) != nil {
		return
	}
	if msg.Type == "viewing" {
		s.SetViewing(client, msg.SpaceID, msg.Active)
	}
}

// setViewing updates which space (if any) a client is actively viewing, and
// whether it currently has that space's chat in focus, then broadcasts the
// resulting presence change. A non-empty spaceID is verified against real
// space membership before being accepted — otherwise a client could claim to
// be viewing a space it has no access to and leak its presence to that
// space's real members.
func (s *RealtimeService) SetViewing(client *RealtimeClient, spaceID string, active bool) {
	if spaceID != "" {
		_, err := s.database.SpaceByID(context.Background(), client.UserID, spaceID)
		if err != nil {
			spaceID = ""
		}
	}

	s.Mu.Lock()
	previous := client.viewingSpaceID
	if previous == spaceID && client.active == active {
		s.Mu.Unlock()
		return
	}
	spaceChanged := previous != spaceID
	if spaceChanged && previous != "" {
		s.removeViewerLocked(previous, client)
	}
	if spaceID != "" {
		if s.Viewers[spaceID] == nil {
			s.Viewers[spaceID] = map[*RealtimeClient]struct{}{}
		}
		s.Viewers[spaceID][client] = struct{}{}
	}
	client.viewingSpaceID = spaceID
	client.active = active
	s.Mu.Unlock()

	if spaceChanged && previous != "" {
		s.broadcastPresence(previous)
	}
	if spaceID != "" {
		s.broadcastPresence(spaceID)
	}
}

// presenceViewer describes one distinct user viewing a space, and whether
// any of their connections currently has that space's chat in focus.
type PresenceViewer struct {
	UserID string `json:"user_id"`
	Active bool   `json:"active"`
}

// broadcastPresence sends the current list of distinct users viewing spaceID
// (and their active/idle status) to every client currently viewing it. A
// user with multiple connections (e.g. two tabs) counts as active if any one
// of them has the space in focus.
func (s *RealtimeService) broadcastPresence(spaceID string) {
	s.Mu.RLock()
	viewers := s.Viewers[spaceID]
	targets := make([]*RealtimeClient, 0, len(viewers))
	activeByUser := map[string]bool{}
	for client := range viewers {
		targets = append(targets, client)
		activeByUser[client.UserID] = activeByUser[client.UserID] || client.active
	}
	s.Mu.RUnlock()

	userIDs := make([]string, 0, len(activeByUser))
	for userID := range activeByUser {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	presenceViewers := make([]PresenceViewer, 0, len(userIDs))
	for _, userID := range userIDs {
		presenceViewers = append(presenceViewers, PresenceViewer{UserID: userID, Active: activeByUser[userID]})
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
		case client.Send <- payload:
		default:
		}
	}
}

func (s *RealtimeService) readLoop(client *RealtimeClient) {
	defer func() { s.Unregister(client); _ = client.conn.Close() }()
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

func (s *RealtimeService) writeLoop(client *RealtimeClient) {
	ticker := time.NewTicker(realtimePingPeriod)
	defer ticker.Stop()
	for {
		select {
		case payload := <-client.Send:
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
		case <-client.Done:
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
	s.Mu.RLock()
	defer s.Mu.RUnlock()
	return len(s.clients)
}
