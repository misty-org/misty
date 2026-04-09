package restic

import (
	"os"
	"path/filepath"
	"testing"
)

// TestStoreLoadDeleteFileFallback verifies the dev-fallback path
// (HelperBinaryPath() == "") writes to a 0600 file under the registry dir
// and reads it back. The keyring path is not exercised here because the
// test environment doesn't have a secret service we can rely on.
func TestStoreLoadDeleteFileFallback(t *testing.T) {
	resetInit()
	t.Setenv("HOME", t.TempDir())
	// Make sure the helper isn't accidentally on PATH or alongside the
	// test binary — we want the file fallback to win.
	t.Setenv("MISTY_PWD_HELPER", "")

	const repoName = "fallback-repo"
	const password = "hunter2-the-sequel"

	if err := StorePassword(repoName, password); err != nil {
		t.Fatalf("StorePassword: %v", err)
	}

	got, err := LoadPassword(repoName)
	if err != nil {
		t.Fatalf("LoadPassword: %v", err)
	}
	if got != password {
		t.Errorf("LoadPassword: got %q, want %q", got, password)
	}

	// Confirm the file landed at the expected location with mode 0600.
	pwdFile := passwordFileFor(RepoConfig{Name: repoName})
	info, err := os.Stat(pwdFile)
	if err != nil {
		t.Fatalf("stat password file: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0600 {
		t.Errorf("password file perm: got %o, want 0600", mode)
	}

	DeletePassword(repoName)
	if _, err := os.Stat(pwdFile); !os.IsNotExist(err) {
		t.Errorf("DeletePassword left file behind: %v", err)
	}
}

// TestLoadPasswordMissing returns a clear error rather than silently
// returning the empty string.
func TestLoadPasswordMissing(t *testing.T) {
	resetInit()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("MISTY_PWD_HELPER", "")

	if _, err := LoadPassword("nope"); err == nil {
		t.Error("expected error for missing password")
	}
}

// TestHelperBinaryPathEnv honors the explicit MISTY_PWD_HELPER override
// (used by tests and packaged installs to point at a non-PATH location).
func TestHelperBinaryPathEnv(t *testing.T) {
	resetInit()
	t.Setenv("HOME", t.TempDir())

	// Drop a real-on-disk file so the os.Stat check inside HelperBinaryPath
	// passes — the contents don't matter, the lookup only needs existence.
	fake := filepath.Join(t.TempDir(), "misty-pwd-helper")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho stub\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MISTY_PWD_HELPER", fake)

	if got := HelperBinaryPath(); got != fake {
		t.Errorf("HelperBinaryPath: got %q, want %q", got, fake)
	}
}
