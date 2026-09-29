package browsersync

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"testing"
)

// signinCipher is a sealed shard at the largest frame native clients send:
// a 512 KiB padded frame plus nonce and tag.
func signinCipher() []byte {
	out := make([]byte, 512<<10+28)
	_, _ = rand.Read(out)
	return out
}

// A device's sign-in data sits in slots on its tree's root node. Only the
// session holding that tree's lock may write it; any device may read it.
func TestBrowserSyncDeviceSigninSlotsFollowTheTreeLock(t *testing.T) {
	store, workspace, d := setupTreeWorkspace(t)
	ctx := context.Background()
	a, b := d[0], d[1]
	treeA := a.grant.DeviceID
	if err := store.EnableBrowserSyncTreeMode(ctx, "owner", workspace); err != nil {
		t.Fatal(err)
	}
	first, second := signinCipher(), signinCipher()
	op := a.op(treeA, 0, nil, []SyncSlotWrite{
		{TabNodeID: treeA, Slot: SyncSlotSigninFirst, Ciphertext: first},
		{TabNodeID: treeA, Slot: SyncSlotSigninLast, Ciphertext: second},
	}, nil)
	if r, err := store.PublishBrowserSyncTree(ctx, "owner", op); err != nil || r.Discarded {
		t.Fatalf("lock holder's sign-in write: %+v %v", r, err)
	}
	slot, err := store.BrowserSyncSlot(ctx, "owner", workspace, b.grant.DeviceID, treeA, treeA, SyncSlotSigninFirst)
	if err != nil || slot == nil || !bytes.Equal(slot.Ciphertext, first) {
		t.Fatalf("another device reads the sign-in shard: %v %v", slot, err)
	}
	// Without the lock, sign-in data cannot be written.
	intruder := b.op(treeA, 1, nil, []SyncSlotWrite{{TabNodeID: treeA, Slot: SyncSlotSigninFirst, Ciphertext: treeCipher()}}, nil)
	if r, err := store.PublishBrowserSyncTree(ctx, "owner", intruder); err != nil || r.Reason != SyncDiscardNotDriver {
		t.Fatalf("non-holder sign-in write: %+v %v", r, err)
	}
	// Taking the lock transfers the right to write, and only that.
	if r, err := store.ClaimBrowserSyncTree(ctx, "owner", b.claim(treeA, "")); err != nil || r.Discarded {
		t.Fatalf("claim: %+v %v", r, err)
	}
	replaced := signinCipher()
	if r, err := store.PublishBrowserSyncTree(ctx, "owner", b.op(treeA, 1, nil, []SyncSlotWrite{{TabNodeID: treeA, Slot: SyncSlotSigninFirst, Ciphertext: replaced}}, nil)); err != nil || r.Discarded {
		t.Fatalf("new holder's sign-in write: %+v %v", r, err)
	}
	if r, err := store.PublishBrowserSyncTree(ctx, "owner", a.op(treeA, 2, nil, []SyncSlotWrite{{TabNodeID: treeA, Slot: SyncSlotSigninFirst, Ciphertext: treeCipher()}}, nil)); err != nil || r.Reason != SyncDiscardNotDriver {
		t.Fatalf("displaced holder still writes sign-in data: %+v %v", r, err)
	}
	slot, err = store.BrowserSyncSlot(ctx, "owner", workspace, a.grant.DeviceID, treeA, treeA, SyncSlotSigninFirst)
	if err != nil || slot == nil || !bytes.Equal(slot.Ciphertext, replaced) {
		t.Fatalf("sign-in shard after takeover: %v %v", slot, err)
	}
	// Three full shards exceed one op: clients must spread them across ops.
	tooBig := b.op(treeA, 2, nil, []SyncSlotWrite{
		{TabNodeID: treeA, Slot: 5, Ciphertext: signinCipher()},
		{TabNodeID: treeA, Slot: 6, Ciphertext: signinCipher()},
		{TabNodeID: treeA, Slot: 7, Ciphertext: signinCipher()},
	}, nil)
	if _, err := store.PublishBrowserSyncTree(ctx, "owner", tooBig); !errors.Is(err, ErrSyncInvalid) {
		t.Fatalf("oversized op accepted: %v", err)
	}
	b.counter--
	// Slot kinds stop at the protocol maximum.
	beyond := b.op(treeA, 2, nil, []SyncSlotWrite{{TabNodeID: treeA, Slot: SyncSlotSigninLast + 1, Ciphertext: treeCipher()}}, nil)
	if _, err := store.PublishBrowserSyncTree(ctx, "owner", beyond); !errors.Is(err, ErrSyncInvalid) {
		t.Fatalf("slot kind past the maximum accepted: %v", err)
	}
}
