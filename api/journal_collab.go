package api

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Journal collaboration tickets for notes and drawings.
//
// A ticket is the only thing the Cloudflare Worker trusts. It is signed with an
// Ed25519 private key that never leaves this server, so a compromise of the
// collaboration service cannot mint access to a private note.

const (
	// Short enough that a revoked user cannot hold a usable ticket for long,
	// long enough to survive a slow client opening a WebSocket.
	journalTicketLifetime     = 60 * time.Second
	journalTicketIssuer       = "misty-api"
	journalTicketAudience     = "misty-journal-collab"
	defaultJournalCollabHost  = "misty-journal-collab.mistysys.workers.dev"
	journalCollabDisabledFlag = "false"
)

// JournalCollabConfig holds everything needed to talk to the shared note and
// drawing collaboration service. It is only usable once every field validates.
type JournalCollabConfig struct {
	Enabled          bool
	Host             string
	Issuer           string
	Audience         string
	privateKey       ed25519.PrivateKey
	controlSecret    []byte
	projectionSecret []byte
	roomSalt         []byte
}

// JournalCollabConfigFromEnv reads the collaboration configuration.
//
// It returns a disabled config with no error when the feature is off, and an
// error only when it is switched on but cannot work. Notes must never fall back
// to an insecure local-only mode, so a misconfiguration is loud.
func JournalCollabConfigFromEnv() (JournalCollabConfig, error) {
	enabledValue := strings.TrimSpace(os.Getenv("MISTY_JOURNAL_COLLAB_ENABLED"))
	config := JournalCollabConfig{
		Enabled:  !strings.EqualFold(enabledValue, journalCollabDisabledFlag),
		Host:     envOrDefault("PARTYKIT_HOST", defaultJournalCollabHost),
		Issuer:   journalTicketIssuer,
		Audience: journalTicketAudience,
	}
	if !config.Enabled {
		return config, nil
	}
	if config.Host == "" {
		return JournalCollabConfig{}, errors.New("PARTYKIT_HOST is required when journal collaboration is enabled")
	}
	if strings.Contains(config.Host, "/") || strings.Contains(config.Host, ":") {
		return JournalCollabConfig{}, errors.New("PARTYKIT_HOST must be a bare hostname")
	}
	privateKey, err := parseEd25519PrivateKey(os.Getenv("JOURNAL_COLLAB_TICKET_PRIVATE_KEY"))
	if err != nil {
		return JournalCollabConfig{}, fmt.Errorf("JOURNAL_COLLAB_TICKET_PRIVATE_KEY: %w", err)
	}
	config.privateKey = privateKey
	if config.controlSecret, err = decodeServiceSecret("JOURNAL_COLLAB_CONTROL_SECRET"); err != nil {
		return JournalCollabConfig{}, err
	}
	if config.projectionSecret, err = decodeServiceSecret("JOURNAL_COLLAB_PROJECTION_SECRET"); err != nil {
		return JournalCollabConfig{}, err
	}
	// Room ids are derived from the control secret rather than configured
	// separately: one fewer secret to rotate, and both sides already share it.
	config.roomSalt = config.controlSecret
	return config, nil
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func parseEd25519PrivateKey(encoded string) (ed25519.PrivateKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, errors.New("must be base64-encoded PKCS#8")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(raw)
	if err != nil {
		return nil, errors.New("must be a PKCS#8 private key")
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("must be an Ed25519 key")
	}
	return key, nil
}

func decodeServiceSecret(name string) ([]byte, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return nil, fmt.Errorf("%s is required when note collaboration is enabled", name)
	}
	secret, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(secret) < 32 {
		return nil, fmt.Errorf("%s must be at least 32 base64-encoded random bytes", name)
	}
	return secret, nil
}

// RoomID derives the opaque room identifier for a note.
//
// The room appears in the collaboration WebSocket URL, which is handled by a
// third-party edge network, so it is deliberately not the note id. The
// derivation is deterministic, so both the ticket endpoint and the control
// sender reach the same room without storing an extra column.
func (c JournalCollabConfig) RoomID(noteID string) string {
	return c.resourceRoomID("note", noteID)
}

// DrawingRoomID derives the opaque room identifier for a drawing.
func (c JournalCollabConfig) DrawingRoomID(drawingID string) string {
	return c.resourceRoomID("drawing", drawingID)
}

func (c JournalCollabConfig) resourceRoomID(resourceType, resourceID string) string {
	mac := hmac.New(sha256.New, c.roomSalt)
	mac.Write([]byte(resourceType + "-room:" + resourceID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))[:32]
}

// SignServicePayload produces the HMAC a service-to-service call carries.
// Timestamp and body are both covered so a captured call cannot be replayed
// later or have its body swapped.
func signServicePayload(secret []byte, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(timestamp))
	mac.Write([]byte("\n"))
	mac.Write(body)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// VerifyProjectionSignature checks a projection callback from the Worker.
func (c JournalCollabConfig) VerifyProjectionSignature(timestamp string, body []byte, signature string) bool {
	expected := signServicePayload(c.projectionSecret, timestamp, body)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// SignControlRequest signs a control command sent to the Worker.
func (c JournalCollabConfig) SignControlRequest(timestamp string, body []byte) string {
	return signServicePayload(c.controlSecret, timestamp, body)
}

// JournalTicket is what the desktop needs in order to open a collaboration socket.
type JournalTicket struct {
	Ticket    string    `json:"ticket"`
	Room      string    `json:"room"`
	URL       string    `json:"url"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"expires_at"`
}

type journalTicketClaims struct {
	Issuer       string `json:"iss"`
	Audience     string `json:"aud"`
	JTI          string `json:"jti"`
	Subject      string `json:"sub"`
	SpaceID      string `json:"space_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	NoteID       string `json:"note_id,omitempty"`
	DrawingID    string `json:"drawing_id,omitempty"`
	Room         string `json:"room"`
	Role         string `json:"role"`
	ACLVersion   int64  `json:"acl_version"`
	Expires      int64  `json:"exp"`
}

type collaborationResource struct {
	Type  string
	ID    string
	Party string
}

// MintNoteTicket signs a single-connection ticket for a note.
//
// Callers must have rechecked note access immediately before calling this: the
// ticket is a bearer credential for the room, and nothing downstream re-reads
// the ACL.
func (c JournalCollabConfig) MintNoteTicket(userID, spaceID, noteID, role string, aclVersion int64) (JournalTicket, error) {
	return c.mintResourceTicket(
		userID,
		spaceID,
		collaborationResource{Type: "note", ID: noteID, Party: "note-room"},
		role,
		aclVersion,
	)
}

// MintDrawingTicket signs a single-use ticket for one DrawingRoom connection.
func (c JournalCollabConfig) MintDrawingTicket(
	userID, spaceID, drawingID, role string,
	aclVersion int64,
) (JournalTicket, error) {
	return c.mintResourceTicket(
		userID,
		spaceID,
		collaborationResource{Type: "drawing", ID: drawingID, Party: "drawing-room"},
		role,
		aclVersion,
	)
}

func (c JournalCollabConfig) mintResourceTicket(
	userID, spaceID string,
	resource collaborationResource,
	role string,
	aclVersion int64,
) (JournalTicket, error) {
	if !c.Enabled {
		return JournalTicket{}, errors.New("journal collaboration is not enabled")
	}
	if userID == "" || spaceID == "" || resource.ID == "" ||
		resource.Type == "" || resource.Party == "" || role == "" || aclVersion < 1 {
		return JournalTicket{}, errors.New("incomplete ticket claims")
	}
	room := c.resourceRoomID(resource.Type, resource.ID)
	expiresAt := time.Now().Add(journalTicketLifetime).UTC()
	claims := journalTicketClaims{
		Issuer: c.Issuer, Audience: c.Audience, JTI: "tkt_" + uuid.NewString(),
		Subject: userID, SpaceID: spaceID,
		ResourceType: resource.Type, ResourceID: resource.ID, Room: room,
		Role: role, ACLVersion: aclVersion, Expires: expiresAt.Unix(),
	}
	if resource.Type == "note" {
		claims.NoteID = resource.ID
	} else if resource.Type == "drawing" {
		claims.DrawingID = resource.ID
	}
	header, err := json.Marshal(map[string]string{"alg": "EdDSA", "typ": "JWT"})
	if err != nil {
		return JournalTicket{}, err
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return JournalTicket{}, err
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." +
		base64.RawURLEncoding.EncodeToString(payload)
	signature := ed25519.Sign(c.privateKey, []byte(signingInput))
	return JournalTicket{
		Ticket: signingInput + "." + base64.RawURLEncoding.EncodeToString(signature),
		Room:   room,
		// The party segment is the kebab-cased Durable Object binding name.
		URL:       fmt.Sprintf("wss://%s/parties/%s/%s", c.Host, resource.Party, room),
		Role:      role,
		ExpiresAt: expiresAt,
	}, nil
}

// SetJournalCollab installs the shared Journal collaboration configuration.
func (s *SpacesService) SetJournalCollab(config JournalCollabConfig) {
	s.journalCollab = config
}

// JournalCollab exposes the configuration for control commands and callbacks.
func (s *SpacesService) JournalCollab() JournalCollabConfig { return s.journalCollab }
