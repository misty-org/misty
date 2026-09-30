package api

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

var realtimeReset = []byte(`{"type":"replay","events":[],"resync_required":true}`)

// Slow consumers reconnect and read durable state; the listener never waits for
// their socket writes and never silently loses a revocation or reset.
func (s *RealtimeService) deliver(client *TestingRealtimeClient, payload []byte) {
	select {
	case <-client.TestingDone:
		return
	default:
	}
	select {
	case client.TestingSend <- payload:
	default:
		if client.conn != nil {
			_ = client.conn.Close()
		}
		s.TestingUnregister(client)
	}
}

func (s *RealtimeService) broadcastReset() {
	s.TestingMu.RLock()
	clients := make([]*TestingRealtimeClient, 0, len(s.clients))
	for client := range s.clients {
		clients = append(clients, client)
	}
	s.TestingMu.RUnlock()
	for _, client := range clients {
		s.deliver(client, realtimeReset)
	}
}

func (s *RealtimeService) BroadcastEvent(eventID int64) {
	s.TestingMu.RLock()
	empty := len(s.clients) == 0
	s.TestingMu.RUnlock()
	if empty {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	members, err := s.database.SpaceEventCandidateUsers(ctx, eventID)
	if err != nil {
		s.broadcastReset()
		return
	}
	s.TestingMu.RLock()
	targets := map[string][]*TestingRealtimeClient{}
	for _, user := range members {
		for client := range s.clientsByUser[user] {
			targets[user] = append(targets[user], client)
		}
	}
	s.TestingMu.RUnlock()
	var payload []byte
	for user, clients := range targets {
		// Resolve current authorization once per account, never once per device.
		// No cross-event permission cache: revocation takes effect on the next event.
		event, err := s.database.EventByIDForUser(ctx, user, eventID)
		if errors.Is(err, db.ErrSpaceNotFound) {
			continue
		}
		if err != nil {
			for _, client := range clients {
				s.deliver(client, realtimeReset)
			}
			continue
		}
		if payload == nil {
			payload, err = json.Marshal(map[string]any{"type": "event", "event": event})
			if err != nil {
				s.broadcastReset()
				return
			}
		}
		for _, client := range clients {
			s.deliver(client, payload)
		}
	}
}
