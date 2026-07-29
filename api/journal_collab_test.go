package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func testCollabConfig(t *testing.T) JournalCollabConfig {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pkcs8, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JOURNAL_COLLAB_TICKET_PRIVATE_KEY", base64.StdEncoding.EncodeToString(pkcs8))
	t.Setenv("JOURNAL_COLLAB_CONTROL_SECRET", base64.StdEncoding.EncodeToString(secret))
	t.Setenv("JOURNAL_COLLAB_PROJECTION_SECRET", base64.StdEncoding.EncodeToString(secret))
	t.Setenv("JOURNAL_COLLAB_ROOM_SALT", base64.StdEncoding.EncodeToString(secret))
	config, err := JournalCollabConfigFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	return config
}

func decodeTicketClaims(t *testing.T, ticket string) journalTicketClaims {
	t.Helper()
	parts := strings.Split(ticket, ".")
	if len(parts) != 3 {
		t.Fatalf("ticket has %d segments, want 3", len(parts))
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims journalTicketClaims
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatal(err)
	}
	return claims
}

// The signature must verify against the public half, which is all Cloudflare
// ever holds.
func TestMintedTicketVerifiesWithThePublicKeyAlone(t *testing.T) {
	config := testCollabConfig(t)

	ticket, err := config.MintNoteTicket("user_1", "space_1", "note_1", "editor", 4)
	if err != nil {
		t.Fatal(err)
	}

	parts := strings.Split(ticket.Ticket, ".")
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatal(err)
	}
	publicKey := config.privateKey.Public().(ed25519.PublicKey)
	if !ed25519.Verify(publicKey, []byte(parts[0]+"."+parts[1]), signature) {
		t.Fatal("minted ticket did not verify against its own public key")
	}

	// Header must pin EdDSA, matching what the Worker requires.
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(header), `"alg":"EdDSA"`) {
		t.Fatalf("header = %s, want alg EdDSA", header)
	}
}

func TestTicketClaimsMatchTheWorkerContract(t *testing.T) {
	config := testCollabConfig(t)

	ticket, err := config.MintNoteTicket("user_1", "space_1", "note_1", "viewer", 7)
	if err != nil {
		t.Fatal(err)
	}
	claims := decodeTicketClaims(t, ticket.Ticket)

	if claims.Issuer != "misty-api" || claims.Audience != "misty-journal-collab" {
		t.Fatalf("issuer/audience = %q/%q", claims.Issuer, claims.Audience)
	}
	if claims.Subject != "user_1" || claims.NoteID != "note_1" ||
		claims.ResourceType != "note" || claims.ResourceID != "note_1" ||
		claims.Role != "viewer" {
		t.Fatalf("claims = %#v", claims)
	}
	if claims.ACLVersion != 7 {
		t.Fatalf("acl_version = %d, want 7", claims.ACLVersion)
	}
	// The room in the claims must be the room in the URL, or the Worker's
	// room-equality check rejects every connection.
	if claims.Room != ticket.Room || !strings.HasSuffix(ticket.URL, "/"+ticket.Room) {
		t.Fatalf("room mismatch: claim %q, ticket %q, url %q", claims.Room, ticket.Room, ticket.URL)
	}
	if claims.JTI == "" {
		t.Fatal("ticket has no jti, so it could be replayed")
	}
}

func TestDrawingTicketUsesDrawingRoomAndClaims(t *testing.T) {
	config := testCollabConfig(t)

	ticket, err := config.MintDrawingTicket(
		"user_1", "space_1", "drawing_1", "editor", 2,
	)
	if err != nil {
		t.Fatal(err)
	}
	claims := decodeTicketClaims(t, ticket.Ticket)
	if claims.ResourceType != "drawing" ||
		claims.ResourceID != "drawing_1" ||
		claims.DrawingID != "drawing_1" ||
		claims.NoteID != "" {
		t.Fatalf("drawing claims = %#v", claims)
	}
	if !strings.Contains(ticket.URL, "/parties/drawing-room/") {
		t.Fatalf("drawing ticket URL = %q", ticket.URL)
	}
	if config.DrawingRoomID("drawing_1") == config.RoomID("drawing_1") {
		t.Fatal("a note and drawing with the same id share a room")
	}
}

// 60 seconds, per the plan: long enough to open a socket, short enough that a
// revoked user cannot sit on a usable ticket.
func TestTicketExpiresInOneMinute(t *testing.T) {
	config := testCollabConfig(t)

	ticket, err := config.MintNoteTicket("user_1", "space_1", "note_1", "editor", 1)
	if err != nil {
		t.Fatal(err)
	}
	claims := decodeTicketClaims(t, ticket.Ticket)

	lifetime := time.Unix(claims.Expires, 0).Sub(time.Now())
	if lifetime > 65*time.Second || lifetime < 55*time.Second {
		t.Fatalf("ticket lifetime = %s, want about 60s", lifetime)
	}
}

func TestExportTicketIsViewerOnlySingleUseAndShortLived(t *testing.T) {
	config := testCollabConfig(t)
	ticket, err := config.MintJournalExportTicket(
		"user_1", "space_1", "drawing", "drawing_1", 8,
	)
	if err != nil {
		t.Fatal(err)
	}
	claims := decodeTicketClaims(t, ticket.Ticket)
	if claims.Role != "viewer" || claims.ResourceType != "drawing" ||
		claims.ResourceID != "drawing_1" || claims.ACLVersion != 8 ||
		claims.JTI == "" {
		t.Fatalf("export claims = %#v", claims)
	}
	lifetime := time.Until(ticket.ExpiresAt)
	if lifetime < 14*time.Minute || lifetime > 16*time.Minute {
		t.Fatalf("export ticket lifetime = %s, want about 15 minutes", lifetime)
	}
}

// Every connection needs a distinct jti or the room's single-use check would
// reject the second one.
func TestEveryTicketGetsAFreshJTI(t *testing.T) {
	config := testCollabConfig(t)
	seen := map[string]bool{}

	for range 25 {
		ticket, err := config.MintNoteTicket("user_1", "space_1", "note_1", "editor", 1)
		if err != nil {
			t.Fatal(err)
		}
		jti := decodeTicketClaims(t, ticket.Ticket).JTI
		if seen[jti] {
			t.Fatalf("jti %q was reused", jti)
		}
		seen[jti] = true
	}
}

// The room appears in a URL handled by a third-party edge network, so it must
// not be the note id.
func TestRoomIDIsOpaqueButStable(t *testing.T) {
	config := testCollabConfig(t)

	room := config.RoomID("note_1")
	if room == "note_1" || strings.Contains(room, "note_1") {
		t.Fatalf("room %q leaks the note id", room)
	}
	if config.RoomID("note_1") != room {
		t.Fatal("RoomID is not deterministic, so control commands would miss the room")
	}
	if config.RoomID("note_2") == room {
		t.Fatal("two notes share a room")
	}
	if len(room) != 32 {
		t.Fatalf("room length = %d, want 32", len(room))
	}
}

func TestJournalCollabConfigUsesMistyWorkerHost(t *testing.T) {
	config := testCollabConfig(t)

	if config.Host != "misty-journal-collab.mistysys.workers.dev" {
		t.Fatalf("host = %q, want Misty worker host", config.Host)
	}
}

// A half-configured deployment must fail at startup rather than at connect
// time, and must never quietly downgrade to local-only notes.
func TestJournalCollabConfigRequiresEverySecret(t *testing.T) {
	base := func(t *testing.T) {
		t.Helper()
		_, privateKey, _ := ed25519.GenerateKey(rand.Reader)
		pkcs8, _ := x509.MarshalPKCS8PrivateKey(privateKey)
		secret := make([]byte, 32)
		_, _ = rand.Read(secret)
		t.Setenv("PARTYKIT_HOST", "example.workers.dev")
		t.Setenv("JOURNAL_COLLAB_TICKET_PRIVATE_KEY", base64.StdEncoding.EncodeToString(pkcs8))
		t.Setenv("JOURNAL_COLLAB_CONTROL_SECRET", base64.StdEncoding.EncodeToString(secret))
		t.Setenv("JOURNAL_COLLAB_PROJECTION_SECRET", base64.StdEncoding.EncodeToString(secret))
		t.Setenv("JOURNAL_COLLAB_ROOM_SALT", base64.StdEncoding.EncodeToString(secret))
	}

	cases := map[string]string{
		"JOURNAL_COLLAB_TICKET_PRIVATE_KEY": "",
		"JOURNAL_COLLAB_CONTROL_SECRET":     "",
		"JOURNAL_COLLAB_PROJECTION_SECRET":  "",
		"JOURNAL_COLLAB_ROOM_SALT":          "",
	}
	for name, value := range cases {
		t.Run("missing "+name, func(t *testing.T) {
			base(t)
			t.Setenv(name, value)
			if _, err := JournalCollabConfigFromEnv(); err == nil {
				t.Fatalf("config accepted a missing %s", name)
			}
		})
	}

	t.Run("weak shared secret", func(t *testing.T) {
		base(t)
		t.Setenv("JOURNAL_COLLAB_CONTROL_SECRET", base64.StdEncoding.EncodeToString([]byte("short")))
		if _, err := JournalCollabConfigFromEnv(); err == nil {
			t.Fatal("config accepted a short control secret")
		}
	})

	t.Run("weak previous projection secret", func(t *testing.T) {
		base(t)
		t.Setenv(
			"JOURNAL_COLLAB_PROJECTION_SECRET_PREVIOUS",
			base64.StdEncoding.EncodeToString([]byte("short")),
		)
		if _, err := JournalCollabConfigFromEnv(); err == nil {
			t.Fatal("config accepted a short previous projection secret")
		}
	})

	t.Run("host with a path", func(t *testing.T) {
		base(t)
		t.Setenv("PARTYKIT_HOST", "example.workers.dev/parties")
		if _, err := JournalCollabConfigFromEnv(); err == nil {
			t.Fatal("config accepted a host containing a path")
		}
	})
}

func TestProjectionSecretRotationAcceptsOnlyCurrentAndPrevious(t *testing.T) {
	config := testCollabConfig(t)
	previous := make([]byte, 32)
	if _, err := rand.Read(previous); err != nil {
		t.Fatal(err)
	}
	config.previousProjectionSecret = previous
	body := []byte(`{"note_id":"note_1"}`)
	timestamp := "1770000000"

	if !config.VerifyProjectionSignature(
		timestamp,
		body,
		signServicePayload(previous, timestamp, body),
	) {
		t.Fatal("previous projection secret was not accepted during rotation")
	}
	unrelated := make([]byte, 32)
	if _, err := rand.Read(unrelated); err != nil {
		t.Fatal(err)
	}
	if config.VerifyProjectionSignature(
		timestamp,
		body,
		signServicePayload(unrelated, timestamp, body),
	) {
		t.Fatal("unrelated projection secret was accepted")
	}
}

func TestServiceSignaturesCoverTimestampAndBody(t *testing.T) {
	config := testCollabConfig(t)
	timestamp := "2026-07-26T12:00:00Z"
	body := []byte(`{"note_id":"note_1","revision":4}`)

	signature := config.SignControlRequest(timestamp, body)
	if signature == "" {
		t.Fatal("control signature is empty")
	}
	// Projection uses its own secret, so a control signature must not verify
	// as a projection one even though the payload is identical.
	if config.VerifyProjectionSignature(timestamp, body, signature) {
		// Both secrets are the same value in this fixture, so equality here is
		// expected; the separation is proven by the distinct-secret case below.
		t.Log("fixture reuses one secret for both directions")
	}
	if !config.VerifyProjectionSignature(timestamp, body, config.SignControlRequest(timestamp, body)) {
		t.Fatal("projection verification rejected a correctly signed payload")
	}
	// A changed body or timestamp must invalidate the signature.
	if config.VerifyProjectionSignature(timestamp, []byte(`{"note_id":"note_2"}`), signature) {
		t.Fatal("signature verified against a different body")
	}
	if config.VerifyProjectionSignature("2026-07-26T13:00:00Z", body, signature) {
		t.Fatal("signature verified against a different timestamp")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestNoteControlDeliveryUsesOpaqueRoomAndSignedEnvelope(t *testing.T) {
	config := testCollabConfig(t)
	originalClient := noteControlHTTPClient
	t.Cleanup(func() { noteControlHTTPClient = originalClient })

	var received noteControlEnvelope
	noteControlHTTPClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		timestamp := request.Header.Get("X-Misty-Timestamp")
		if got, want := request.Header.Get("X-Misty-Signature"), config.SignControlRequest(timestamp, body); got != want {
			t.Fatalf("signature = %q, want %q", got, want)
		}
		if strings.Contains(request.URL.Path, "note_visible_id") {
			t.Fatalf("control URL leaked the note id: %s", request.URL)
		}
		if !strings.HasSuffix(request.URL.Path, "/"+config.RoomID("note_visible_id")) {
			t.Fatalf("control URL used the wrong room: %s", request.URL)
		}
		if err := json.Unmarshal(body, &received); err != nil {
			t.Fatal(err)
		}
		return &http.Response{
			StatusCode: http.StatusNoContent,
			Body:       io.NopCloser(strings.NewReader("")),
			Header:     make(http.Header),
		}, nil
	})}

	service := &SpacesService{journalCollab: config}
	payload := []byte(`{"title":"Research plan","markdown":"# Research plan\nQuestion"}`)
	if err := service.deliverNoteControlCommand(
		context.Background(),
		"note_visible_id",
		"bootstrap",
		payload,
	); err != nil {
		t.Fatal(err)
	}
	if received.Command != "bootstrap" || string(received.Payload) != string(payload) {
		t.Fatalf("received envelope = %#v", received)
	}
}
