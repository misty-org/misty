package db

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	. "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// Each device in a pair decides whether the other may change its files. Its
// choice reaches the other device's peer list and the tickets that device gets.
func TestDevicePairFileWriteConsentReachesPeersAndTickets(t *testing.T) {
	admin := openTestDatabase(t)
	owner, err := admin.CreateUser("Pair owner", "pair-owner@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	other, err := admin.CreateUser("Pair other", "pair-other@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	runtime := openRuntimeRoleDatabase(t, admin)
	register := func(key, endpoint string) *TrustedDevice {
		digest := sha256.Sum256([]byte(key))
		device, err := runtime.RegisterTrustedDevice(owner.ID, key, base64.RawURLEncoding.EncodeToString(digest[:]), "macos", endpoint, json.RawMessage(`["misty-device/1"]`), json.RawMessage(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		return device
	}
	first := register("first", strings.Repeat("a", 64))
	second := register("second", strings.Repeat("b", 64))

	hash := func(value string) string {
		digest := sha256.Sum256([]byte(value))
		return hex.EncodeToString(digest[:])
	}
	session, err := runtime.CreateDevicePairingSession(owner.ID, first.ID, hash("qr"), hash("code"), time.Now().Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = runtime.RedeemDevicePairingSession(owner.ID, second.ID, session.ID, hash("code")); err != nil {
		t.Fatal(err)
	}
	pair, err := runtime.ConfirmDevicePairing(owner.ID, first.ID, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	peer := func(device *TrustedDevice) ConnectedPeer {
		peers, err := runtime.ConnectedPeers(owner.ID, device.ID)
		if err != nil || len(peers) != 1 {
			t.Fatalf("peers of %s: %v %v", device.ID, peers, err)
		}
		return peers[0]
	}
	if view := peer(first); view.FilesAcceptWrites || view.FilesCanWrite {
		t.Fatalf("changes must start off: %+v", view)
	}

	// The second device lets the first change its files.
	if err = runtime.SetDevicePairFileWrites(owner.ID, second.ID, pair.ID, true); err != nil {
		t.Fatal(err)
	}
	if view := peer(first); !view.FilesCanWrite || view.FilesAcceptWrites {
		t.Fatalf("first device's view: %+v", view)
	}
	if view := peer(second); !view.FilesAcceptWrites || view.FilesCanWrite {
		t.Fatalf("second device's view: %+v", view)
	}
	toSecond, err := runtime.PeerTicketSubject(owner.ID, first.ID, second.ID)
	if err != nil || !toSecond.TargetAcceptsWrites {
		t.Fatalf("ticket to the consenting device: %+v %v", toSecond, err)
	}
	toFirst, err := runtime.PeerTicketSubject(owner.ID, second.ID, first.ID)
	if err != nil || toFirst.TargetAcceptsWrites {
		t.Fatalf("ticket to the other device: %+v %v", toFirst, err)
	}

	// Another account cannot change the pair, and a revoked pair cannot change.
	if err = runtime.SetDevicePairFileWrites(other.ID, second.ID, pair.ID, false); !errors.Is(err, ErrDevicePair) {
		t.Fatalf("another account changed consent: %v", err)
	}
	if err = runtime.RevokeDevicePair(owner.ID, first.ID, pair.ID); err != nil {
		t.Fatal(err)
	}
	if err = runtime.SetDevicePairFileWrites(owner.ID, second.ID, pair.ID, false); !errors.Is(err, ErrDevicePair) {
		t.Fatalf("revoked pair changed consent: %v", err)
	}
}
