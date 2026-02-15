package syncindex

import (
	"database/sql"
	"testing"
	"time"

	dbpkg "github.com/kannachi323/misty/proxy/db"
)

func TestReconcileStateRemoteOnlyIsCleanREM(t *testing.T) {
	entry := dbpkg.SyncEntry{
		RemoteExists: true,
		RemoteMTime:  time.Now().UTC().Format(time.RFC3339Nano),
		RemoteSize:   sql.NullInt64{Int64: 42, Valid: true},
	}

	state, dirty, direction := reconcileState(entry)
	if state != "REM" || dirty || direction != "none" {
		t.Fatalf("got (%q, %v, %q), want (%q, %v, %q)", state, dirty, direction, "REM", false, "none")
	}
}

func TestReconcileStateMatchingLocalAndRemoteIsCleanLOC(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	entry := dbpkg.SyncEntry{
		LocalExists:  true,
		RemoteExists: true,
		LocalMTime:   now,
		RemoteMTime:  now,
		LocalSize:    sql.NullInt64{Int64: 128, Valid: true},
		RemoteSize:   sql.NullInt64{Int64: 128, Valid: true},
	}

	state, dirty, direction := reconcileState(entry)
	if state != "LOC" || dirty || direction != "none" {
		t.Fatalf("got (%q, %v, %q), want (%q, %v, %q)", state, dirty, direction, "LOC", false, "none")
	}
}

func TestReconcileStateLocalOnlyIsDirtyPush(t *testing.T) {
	entry := dbpkg.SyncEntry{
		LocalExists: true,
		LocalMTime:  time.Now().UTC().Format(time.RFC3339Nano),
		LocalSize:   sql.NullInt64{Int64: 11, Valid: true},
	}

	state, dirty, direction := reconcileState(entry)
	if state != "LOC" || !dirty || direction != "push" {
		t.Fatalf("got (%q, %v, %q), want (%q, %v, %q)", state, dirty, direction, "LOC", true, "push")
	}
}

func TestReconcileStateDivergedNewerRemoteIsDirtyPull(t *testing.T) {
	localTime := time.Date(2026, 4, 16, 10, 0, 0, 0, time.UTC)
	remoteTime := localTime.Add(5 * time.Minute)
	entry := dbpkg.SyncEntry{
		LocalExists:  true,
		RemoteExists: true,
		LocalMTime:   localTime.Format(time.RFC3339Nano),
		RemoteMTime:  remoteTime.Format(time.RFC3339Nano),
		LocalSize:    sql.NullInt64{Int64: 128, Valid: true},
		RemoteSize:   sql.NullInt64{Int64: 256, Valid: true},
	}

	state, dirty, direction := reconcileState(entry)
	if state != "MOD" || !dirty || direction != "pull" {
		t.Fatalf("got (%q, %v, %q), want (%q, %v, %q)", state, dirty, direction, "MOD", true, "pull")
	}
}

func TestReconcileStateDivergedNewerLocalIsDirtyPush(t *testing.T) {
	remoteTime := time.Date(2026, 4, 16, 10, 0, 0, 0, time.UTC)
	localTime := remoteTime.Add(5 * time.Minute)
	entry := dbpkg.SyncEntry{
		LocalExists:  true,
		RemoteExists: true,
		LocalMTime:   localTime.Format(time.RFC3339Nano),
		RemoteMTime:  remoteTime.Format(time.RFC3339Nano),
		LocalSize:    sql.NullInt64{Int64: 256, Valid: true},
		RemoteSize:   sql.NullInt64{Int64: 128, Valid: true},
	}

	state, dirty, direction := reconcileState(entry)
	if state != "MOD" || !dirty || direction != "push" {
		t.Fatalf("got (%q, %v, %q), want (%q, %v, %q)", state, dirty, direction, "MOD", true, "push")
	}
}
