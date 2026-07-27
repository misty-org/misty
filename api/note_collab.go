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

// Note collaboration tickets.
//
// A ticket is the only thing the Cloudflare Worker trusts. It is signed with an
// Ed25519 private key that never leaves this server, so a compromise of the
// collaboration service cannot mint access to a private note.

const (
	// Short enough that a revoked user cannot hold a usable ticket for long,
	// long enough to survive a slow client opening a WebSocket.
	noteTicketLifetime = 60 * time.Second
	noteTicketIssuer   = "misty-api"
	noteTicketAudience = "misty-note-collab"
)

// NoteCollabConfig holds everything needed to talk to the collaboration
// service. It is only usable once every field validates, so a half-configured
// deployment reports Notes as unavailable rather than failing at connect time.
type NoteCollabConfig struct {
	Enabled          bool
	Host             string
	Issuer           string
	Audience         string
	privateKey       ed25519.PrivateKey
	controlSecret    []byte
	projectionSecret []byte
	roomSalt         []byte
}

// NoteCollabConfigFromEnv reads the collaboration configuration.
//
// It returns a disabled config with no error when the feature is off, and an
// error only when it is switched on but cannot work. Notes must never fall back
// to an insecure local-only mode, so a misconfiguration is loud.
func NoteCollabConfigFromEnv() (NoteCollabConfig, error) {
	config := NoteCollabConfig{
		Enabled:  strings.EqualFold(strings.TrimSpace(os.Getenv("MISTY_NOTES_COLLAB_ENABLED")), "true"),
		Host:     strings.TrimSpace(os.Getenv("PARTYKIT_HOST")),
		Issuer:   noteTicketIssuer,
		Audience: noteTicketAudience,
	}
	if !config.Enabled {
		return config, nil
	}
	if config.Host == "" {
		return NoteCollabConfig{}, errors.New("PARTYKIT_HOST is required when note collaboration is enabled")
	}
	if strings.Contains(config.Host, "/") || strings.Contains(config.Host, ":") {
		return NoteCollabConfig{}, errors.New("PARTYKIT_HOST must be a bare hostname")
	}
	privateKey, err := parseEd25519PrivateKey(os.Getenv("NOTE_COLLAB_TICKET_PRIVATE_KEY"))
	if err != nil {
		return NoteCollabConfig{}, fmt.Errorf("NOTE_COLLAB_TICKET_PRIVATE_KEY: %w", err)
	}
	config.privateKey = privateKey
	if config.controlSecret, err = decodeServiceSecret("NOTE_COLLAB_CONTROL_SECRET"); err != nil {
		return NoteCollabConfig{}, err
	}
	if config.projectionSecret, err = decodeServiceSecret("NOTE_COLLAB_PROJECTION_SECRET"); err != nil {
		return NoteCollabConfig{}, err
	}
	// Room ids are derived from the control secret rather than configured
	// separately: one fewer secret to rotate, and both sides already share it.
	config.roomSalt = config.controlSecret
	return config, nil
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
func (c NoteCollabConfig) RoomID(noteID string) string {
	mac := hmac.New(sha256.New, c.roomSalt)
	mac.Write([]byte("note-room:" + noteID))
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
func (c NoteCollabConfig) VerifyProjectionSignature(timestamp string, body []byte, signature string) bool {
	expected := signServicePayload(c.projectionSecret, timestamp, body)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// SignControlRequest signs a control command sent to the Worker.
func (c NoteCollabConfig) SignControlRequest(timestamp string, body []byte) string {
	return signServicePayload(c.controlSecret, timestamp, body)
}

// NoteTicket is what the desktop needs in order to open a collaboration socket.
type NoteTicket struct {
	Ticket    string    `json:"ticket"`
	Room      string    `json:"room"`
	URL       string    `json:"url"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"expires_at"`
}

type noteTicketClaims struct {
	Issuer     string `json:"iss"`
	Audience   string `json:"aud"`
	JTI        string `json:"jti"`
	Subject    string `json:"sub"`
	SpaceID    string `json:"space_id"`
	NoteID     string `json:"note_id"`
	Room       string `json:"room"`
	Role       string `json:"role"`
	ACLVersion int64  `json:"acl_version"`
	Expires    int64  `json:"exp"`
}

// MintTicket signs a single-connection ticket.
//
// Callers must have rechecked note access immediately before calling this: the
// ticket is a bearer credential for the room, and nothing downstream re-reads
// the ACL.
func (c NoteCollabConfig) MintTicket(userID, spaceID, noteID, role string, aclVersion int64) (NoteTicket, error) {
	if !c.Enabled {
		return NoteTicket{}, errors.New("note collaboration is not enabled")
	}
	if userID == "" || spaceID == "" || noteID == "" || role == "" || aclVersion < 1 {
		return NoteTicket{}, errors.New("incomplete ticket claims")
	}
	room := c.RoomID(noteID)
	expiresAt := time.Now().Add(noteTicketLifetime).UTC()
	claims := noteTicketClaims{
		Issuer: c.Issuer, Audience: c.Audience, JTI: "tkt_" + uuid.NewString(),
		Subject: userID, SpaceID: spaceID, NoteID: noteID, Room: room,
		Role: role, ACLVersion: aclVersion, Expires: expiresAt.Unix(),
	}
	header, err := json.Marshal(map[string]string{"alg": "EdDSA", "typ": "JWT"})
	if err != nil {
		return NoteTicket{}, err
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return NoteTicket{}, err
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." +
		base64.RawURLEncoding.EncodeToString(payload)
	signature := ed25519.Sign(c.privateKey, []byte(signingInput))
	return NoteTicket{
		Ticket: signingInput + "." + base64.RawURLEncoding.EncodeToString(signature),
		Room:   room,
		// The party segment is the kebab-cased Durable Object binding name.
		URL:       fmt.Sprintf("wss://%s/parties/note-room/%s", c.Host, room),
		Role:      role,
		ExpiresAt: expiresAt,
	}, nil
}

// SetNoteCollab installs the collaboration configuration. Notes report as
// unavailable until this is called with an enabled config.
func (s *SpacesService) SetNoteCollab(config NoteCollabConfig) {
	s.noteCollab = config
}

// NoteCollab exposes the configuration for callers that deliver control
// commands or verify projection callbacks.
func (s *SpacesService) NoteCollab() NoteCollabConfig { return s.noteCollab }
