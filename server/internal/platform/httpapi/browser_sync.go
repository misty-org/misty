package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"github.com/kannachi323/misty/server/internal/platform/security"
)

type BrowserSyncService struct{ database *db.Database }

func NewBrowserSyncService(database *db.Database) *BrowserSyncService {
	return &BrowserSyncService{database}
}

func syncErrorCode(err error) (string, int) {
	switch {
	case errors.Is(err, db.ErrSyncInvalid):
		return "invalid_sync_request", 400
	case errors.Is(err, db.ErrSyncForbidden):
		return "sync_device_forbidden", 403
	case errors.Is(err, db.ErrSyncExists):
		return "sync_workspace_exists", 409
	case errors.Is(err, db.ErrSyncEpoch):
		return "sync_key_epoch_changed", 409
	case errors.Is(err, db.ErrSyncCounterGap):
		return "sync_counter_gap", 409
	case errors.Is(err, db.ErrSyncOperationConflict):
		return "sync_operation_conflict", 409
	case errors.Is(err, db.ErrSyncCompacted):
		return "sync_operation_compacted", 409
	case errors.Is(err, db.ErrSyncCursor):
		return "sync_cursor_invalid", 409
	default:
		return "sync_unavailable", 503
	}
}
func writeSyncError(w http.ResponseWriter, err error) {
	code, status := syncErrorCode(err)
	writeJSON(w, status, map[string]string{"code": code})
}
func decodeSync(r io.Reader, target any) error {
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return db.ErrSyncInvalid
	}
	return nil
}
func (s *BrowserSyncService) user(w http.ResponseWriter, r *http.Request) (string, bool) {
	w.Header().Set("Cache-Control", "no-store")
	user, ok := authenticatedUser(w, r, s.database)
	if !ok {
		return "", false
	}
	if db.AppAuthorityFromContext(r.Context()) != nil {
		writeSyncError(w, db.ErrSyncForbidden)
		return "", false
	}
	return user, true
}
func (s *BrowserSyncService) Workspace() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.user(w, r)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			workspace, err := s.database.BrowserSyncWorkspace(r.Context(), user)
			if err != nil {
				writeSyncError(w, err)
				return
			}
			writeJSON(w, 200, map[string]any{"workspace": workspace})
			return
		}
		var body struct {
			RootPublicKey []byte             `json:"root_public_key"`
			KeyEnvelope   db.SyncKeyEnvelope `json:"key_envelope"`
			Device        db.SyncDeviceGrant `json:"device"`
		}
		if err := decodeSync(http.MaxBytesReader(w, r.Body, 16384), &body); err != nil {
			writeSyncError(w, err)
			return
		}
		if err := s.database.CreateBrowserSyncWorkspace(r.Context(), user, body.RootPublicKey, body.KeyEnvelope, body.Device); err != nil {
			writeSyncError(w, err)
			return
		}
		writeJSON(w, 201, map[string]string{"workspace_id": body.Device.WorkspaceID})
	}
}
func (s *BrowserSyncService) Devices() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.user(w, r)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			workspace, err := s.database.BrowserSyncWorkspace(r.Context(), user)
			if err != nil {
				writeSyncError(w, err)
				return
			}
			if workspace == nil {
				writeSyncError(w, db.ErrSyncForbidden)
				return
			}
			devices, err := s.database.BrowserSyncDevices(r.Context(), user, workspace.WorkspaceID)
			if err != nil {
				writeSyncError(w, err)
				return
			}
			writeJSON(w, 200, map[string]any{"devices": devices})
			return
		}
		var body db.SyncDeviceGrant
		if err := decodeSync(http.MaxBytesReader(w, r.Body, 8192), &body); err != nil {
			writeSyncError(w, err)
			return
		}
		if err := s.database.EnrollBrowserSyncDevice(r.Context(), user, body); err != nil {
			writeSyncError(w, err)
			return
		}
		_ = s.database.NotifyBrowserSyncPresence(r.Context(), db.SyncConnectionIdentity{UserID: user, WorkspaceID: body.WorkspaceID})
		writeJSON(w, 201, map[string]string{"device_id": body.DeviceID})
	}
}
func (s *BrowserSyncService) Ticket() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.user(w, r)
		if !ok {
			return
		}
		var body struct {
			WorkspaceID     string `json:"workspace_id"`
			DeviceID        string `json:"device_id"`
			ProtocolVersion int    `json:"protocol_version"`
		}
		if err := decodeSync(http.MaxBytesReader(w, r.Body, 4096), &body); err != nil {
			writeSyncError(w, err)
			return
		}
		if body.ProtocolVersion != 1 {
			writeJSON(w, 426, map[string]string{"code": "sync_protocol_unsupported"})
			return
		}
		token, err := security.GenerateSecureToken()
		if err != nil {
			writeSyncError(w, err)
			return
		}
		if err = s.database.CreateBrowserSyncTicket(r.Context(), user, body.WorkspaceID, body.DeviceID, security.HashToken(token)); err != nil {
			writeSyncError(w, err)
			return
		}
		writeJSON(w, 201, map[string]any{"ticket": token, "expires_in": 60})
	}
}

func syncConnectionProof(workspace, device, challenge string) []byte {
	raw, _ := json.Marshal([]any{"misty.sync.connect.v1", workspace, device, challenge})
	return raw
}

var browserSyncUpgrader = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096,
	// A one-use authenticated ticket AND a fresh native-device signature are
	// required. No cookie-only browser upgrade can join this stream.
	CheckOrigin: func(*http.Request) bool { return true }, HandshakeTimeout: 10 * time.Second}

type syncClientFrame struct {
	Type            string           `json:"type"`
	Signature       []byte           `json:"signature,omitempty"`
	After           int64            `json:"after,omitempty"`
	Mutation        *db.SyncMutation `json:"mutation,omitempty"`
	AppliedSequence int64            `json:"applied_sequence,omitempty"`
	Ready           bool             `json:"ready,omitempty"`
	ActiveEpoch     string           `json:"active_epoch,omitempty"`
	Activation      *db.SyncMutation `json:"activation,omitempty"`
}

func (s *BrowserSyncService) Connect() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !websocket.IsWebSocketUpgrade(r) {
			w.Header().Set("Upgrade", "websocket")
			w.WriteHeader(426)
			return
		}
		token := r.URL.Query().Get("ticket")
		if len(token) < 32 || len(token) > 128 {
			writeSyncError(w, db.ErrSyncForbidden)
			return
		}
		identity, err := s.database.ConsumeBrowserSyncTicket(r.Context(), security.HashToken(token))
		if err != nil {
			writeSyncError(w, err)
			return
		}
		conn, err := browserSyncUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		challenge, err := security.GenerateSecureToken()
		if err != nil {
			return
		}
		conn.SetReadLimit(4096)
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if conn.WriteJSON(map[string]any{"type": "challenge", "protocol_version": 1, "challenge": challenge}) != nil {
			return
		}
		kind, raw, err := conn.ReadMessage()
		if err != nil || kind != websocket.TextMessage {
			return
		}
		var auth syncClientFrame
		if decodeSync(bytes.NewReader(raw), &auth) != nil || auth.Type != "authenticate" || auth.After < 0 || auth.After > db.SyncMaxCounter || len(identity.PublicKey) != ed25519.PublicKeySize || !ed25519.Verify(identity.PublicKey, syncConnectionProof(identity.WorkspaceID, identity.DeviceID, challenge), auth.Signature) {
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "Device proof required"), time.Now().Add(time.Second))
			return
		}
		s.serveConnection(r.Context(), conn, *identity, auth.After)
	}
}

func (s *BrowserSyncService) serveConnection(parent context.Context, conn *websocket.Conn, identity db.SyncConnectionIdentity, after int64) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	connectionID := uuid.NewString()
	if s.database.BrowserSyncHeartbeat(ctx, identity, connectionID, after, false) != nil {
		return
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		_ = s.database.BrowserSyncDisconnect(cleanup, identity, connectionID)
		_ = s.database.NotifyBrowserSyncPresence(cleanup, identity)
	}()
	events, unsubscribe, err := s.database.SubscribeAccountEvents(ctx, identity.UserID)
	if err != nil {
		return
	}
	defer unsubscribe()
	_ = s.database.NotifyBrowserSyncPresence(ctx, identity)
	outgoing := make(chan any, 16)
	resume := make(chan int64, 1)
	done := make(chan struct{})
	send := func(frame any) bool {
		select {
		case outgoing <- frame:
			return true
		case <-ctx.Done():
			return false
		default:
			cancel()
			_ = conn.Close()
			return false
		}
	}
	go func() {
		defer close(done)
		defer cancel()
		defer conn.Close()
		s.writeConnection(ctx, conn, identity, connectionID, after, events, outgoing, resume)
	}()
	defer func() { cancel(); _ = conn.Close(); <-done }()
	applied, ready := after, false
	activeEpoch := ""
	heartbeat := func() error {
		bounded, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		if err := s.database.BrowserSyncHeartbeat(bounded, identity, connectionID, applied, ready, activeEpoch); err != nil {
			return err
		}
		return conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	}
	conn.SetReadLimit(1500 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { return heartbeat() })
	windowStart := time.Now()
	messages := 0
	for {
		kind, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if time.Since(windowStart) >= 5*time.Second {
			windowStart = time.Now()
			messages = 0
		}
		messages++
		if messages > 64 || kind != websocket.TextMessage {
			return
		}
		var frame syncClientFrame
		if err = decodeSync(bytes.NewReader(raw), &frame); err != nil {
			send(map[string]any{"type": "error", "code": "invalid_sync_frame"})
			continue
		}
		switch frame.Type {
		case "publish":
			if frame.Mutation == nil || frame.Mutation.WorkspaceID != identity.WorkspaceID || frame.Mutation.DeviceID != identity.DeviceID {
				send(map[string]any{"type": "error", "code": "sync_device_forbidden"})
				continue
			}
			bounded, stop := context.WithTimeout(ctx, 10*time.Second)
			receipt, err := s.database.PublishBrowserSync(bounded, identity.UserID, *frame.Mutation, db.SyncPublishOptions{ActiveEpoch: frame.ActiveEpoch})
			stop()
			if err != nil {
				code, _ := syncErrorCode(err)
				if !send(map[string]any{"type": "error", "operation_id": frame.Mutation.OperationID, "code": code}) {
					return
				}
				if errors.Is(err, db.ErrSyncForbidden) {
					return
				}
			} else if !send(map[string]any{"type": "ack", "receipt": receipt}) {
				return
			}
		case "heartbeat":
			if frame.AppliedSequence < applied || frame.AppliedSequence > db.SyncMaxCounter {
				send(map[string]any{"type": "error", "code": "sync_cursor_invalid"})
				continue
			}
			applied, ready = frame.AppliedSequence, frame.Ready
			activeEpoch = frame.ActiveEpoch
			if heartbeat() != nil {
				return
			}
			if frame.Activation != nil {
				m := frame.Activation
				if m.WorkspaceID != identity.WorkspaceID || m.DeviceID != identity.DeviceID {
					send(map[string]any{"type": "error", "code": "sync_device_forbidden"})
					continue
				}
				bounded, stop := context.WithTimeout(ctx, 10*time.Second)
				receipt, err := s.database.PublishBrowserSync(bounded, identity.UserID, *m, db.SyncPublishOptions{Activate: true})
				stop()
				if err != nil {
					code, _ := syncErrorCode(err)
					if !send(map[string]any{"type": "error", "operation_id": m.OperationID, "code": code}) {
						return
					}
				} else if !send(map[string]any{"type": "ack", "receipt": receipt}) {
					return
				}
			}
		case "resume":
			if frame.After < 0 || frame.After > db.SyncMaxCounter {
				send(map[string]any{"type": "error", "code": "sync_cursor_invalid"})
				continue
			}
			select {
			case resume <- frame.After:
			case <-ctx.Done():
				return
			default:
				return
			}
		default:
			if !send(map[string]any{"type": "error", "code": "unknown_sync_frame"}) {
				return
			}
		}
	}
}

func (s *BrowserSyncService) writeConnection(ctx context.Context, conn *websocket.Conn, identity db.SyncConnectionIdentity, connectionID string, cursor int64, events <-chan db.AccountEvent, outgoing <-chan any, resume <-chan int64) {
	write := func(value any) error {
		if err := conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
			return err
		}
		return conn.WriteJSON(value)
	}
	workspace, err := s.database.BrowserSyncWorkspace(ctx, identity.UserID)
	if err != nil || workspace == nil {
		return
	}
	if write(map[string]any{"type": "welcome", "workspace": workspace, "connection_id": connectionID}) != nil {
		return
	}
	var lastDevices, lastPresence []byte
	presence := func() error {
		bounded, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		devices, err := s.database.BrowserSyncDevices(bounded, identity.UserID, identity.WorkspaceID)
		if err != nil {
			return err
		}
		allowed := false
		for _, d := range devices {
			if d.DeviceID == identity.DeviceID && d.RevokedAt == nil {
				allowed = true
			}
		}
		if !allowed {
			return db.ErrSyncForbidden
		}
		raw, _ := json.Marshal(devices)
		if !bytes.Equal(raw, lastDevices) {
			if err = write(map[string]any{"type": "devices", "devices": devices}); err != nil {
				return err
			}
			lastDevices = raw
		}
		online, err := s.database.BrowserSyncPresence(bounded, identity.UserID, identity.WorkspaceID)
		if err != nil {
			return err
		}
		raw, _ = json.Marshal(online)
		if !bytes.Equal(raw, lastPresence) {
			if err = write(map[string]any{"type": "presence", "devices": online}); err != nil {
				return err
			}
			lastPresence = raw
		}
		return nil
	}
	blocked := false
	replay := func() error {
		if blocked {
			return nil
		}
		if err := presence(); err != nil {
			return err
		}
		for {
			bounded, stop := context.WithTimeout(ctx, 5*time.Second)
			page, err := s.database.ReplayBrowserSync(bounded, identity.UserID, identity.WorkspaceID, identity.DeviceID, cursor, 200)
			stop()
			if err != nil {
				return err
			}
			if page.CheckpointRequired {
				blocked = true
				return write(map[string]any{"type": "checkpoint_required", "head_sequence": page.HeadSequence})
			}
			if len(page.Events) == 0 {
				return nil
			}
			if err = write(map[string]any{"type": "events", "replay": page}); err != nil {
				return err
			}
			cursor = page.Events[len(page.Events)-1].Sequence
			if cursor >= page.HeadSequence {
				return nil
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
		}
	}
	if replay() != nil {
		return
	}
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	// Hints can be dropped. Bounded reconciliation makes durability independent
	// of LISTEN delivery or another server instance's in-memory subscriber state.
	reconcile := time.NewTicker(5 * time.Second)
	defer reconcile.Stop()
	expiry := time.NewTimer(10 * time.Minute)
	defer expiry.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-expiry.C:
			closeBrowserSyncForReconnect(conn)
			return
		case next := <-resume:
			cursor = next
			blocked = false
			if replay() != nil {
				return
			}
		case frame := <-outgoing:
			if write(frame) != nil {
				return
			}
		case event := <-events:
			if event.Topic == "reset" || event.Topic == "browser-sync" {
				if replay() != nil {
					return
				}
			}
			if event.Topic == "browser-presence" {
				if presence() != nil {
					return
				}
			}
			if event.Topic != "browser-sync" && event.Topic != "browser-presence" {
				event.UserID = ""
				if write(map[string]any{"type": "account_event", "event": event}) != nil {
					return
				}
			}
		case <-reconcile.C:
			if replay() != nil {
				return
			}
			if blocked && presence() != nil {
				return
			}
		case <-ping.C:
			if conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)) != nil {
				return
			}
		}
	}
}
