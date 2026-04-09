package restic

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
)

// resetInit clears the package-level state set by Init() and the helper
// binary cache so the next call re-runs against the current HOME (which
// tests override via t.Setenv).
func resetInit() {
	initOnce = sync.Once{}
	binaryPath = ""
	binaryError = nil
	registryDir = ""
	helperOnce = sync.Once{}
	helperBinPath = ""
}

// setupTest skips if restic isn't installed, isolates HOME to a temp dir, and
// returns a fresh RepoConfig pointing at a local: repo path under another temp
// dir. The repo is *not* initialized — the test does that itself.
func setupTest(t *testing.T) RepoConfig {
	t.Helper()
	if _, err := exec.LookPath("restic"); err != nil {
		t.Skip("restic binary not found in PATH; skipping")
	}

	resetInit()
	t.Setenv("HOME", t.TempDir())

	repoDir := filepath.Join(t.TempDir(), "repo")
	return RepoConfig{
		Name: "test-repo",
		URL:  "local:" + repoDir,
	}
}

func TestInitAndSnapshotsEmpty(t *testing.T) {
	repo := setupTest(t)
	ctx := context.Background()

	if err := InitRepo(ctx, repo, "test-password-1234"); err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	snaps, err := Snapshots(ctx, repo)
	if err != nil {
		t.Fatalf("Snapshots: %v", err)
	}
	if len(snaps) != 0 {
		t.Errorf("expected 0 snapshots in fresh repo, got %d", len(snaps))
	}
}

func TestInitDuplicateFails(t *testing.T) {
	repo := setupTest(t)
	ctx := context.Background()

	if err := InitRepo(ctx, repo, "test-password-1234"); err != nil {
		t.Fatalf("first InitRepo: %v", err)
	}
	if err := InitRepo(ctx, repo, "test-password-1234"); err == nil {
		t.Error("expected error initializing already-initialized repo")
	}
}

func TestSnapshotsBadRepo(t *testing.T) {
	repo := setupTest(t)
	repo.URL = "local:" + filepath.Join(t.TempDir(), "does-not-exist")

	// Operations need a password file to exist before they'll exec restic.
	if err := writePasswordFile(repo, "x"); err != nil {
		t.Fatal(err)
	}

	if _, err := Snapshots(context.Background(), repo); err == nil {
		t.Error("expected error listing snapshots from nonexistent repo")
	}
}

func TestSnapshotsWithoutPasswordFile(t *testing.T) {
	repo := setupTest(t)
	// Init() runs implicitly via the first call inside resticCmd; we don't
	// write a password file, so it should fail with a clear error.
	_, err := Snapshots(context.Background(), repo)
	if err == nil {
		t.Error("expected error when password file is missing")
	}
}

// makeTestSource creates a small directory tree to back up and returns its
// root path.
func makeTestSource(t *testing.T) string {
	t.Helper()
	src := filepath.Join(t.TempDir(), "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "hello.txt"), []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "nested.txt"), []byte("nested data"), 0644); err != nil {
		t.Fatal(err)
	}
	return src
}

func TestBackupAndSnapshot(t *testing.T) {
	repo := setupTest(t)
	ctx := context.Background()

	if err := InitRepo(ctx, repo, "test-password-1234"); err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	src := makeTestSource(t)

	var sawSummary bool
	summary, err := Backup(ctx, repo, []string{src}, BackupOpts{Tags: []string{"test"}}, func(e ProgressEvent) {
		if e.Type == "summary" {
			sawSummary = true
		}
	})
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}
	if summary == nil || summary.SnapshotID == "" {
		t.Fatal("Backup: missing summary or snapshot ID")
	}
	if summary.FilesNew < 2 {
		t.Errorf("Backup: expected at least 2 new files, got %d", summary.FilesNew)
	}
	if !sawSummary {
		t.Error("expected a summary event in progress stream")
	}

	snaps, err := Snapshots(ctx, repo)
	if err != nil {
		t.Fatalf("Snapshots: %v", err)
	}
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
}

func TestBackupRestoreLs(t *testing.T) {
	repo := setupTest(t)
	ctx := context.Background()

	if err := InitRepo(ctx, repo, "test-password-1234"); err != nil {
		t.Fatalf("InitRepo: %v", err)
	}
	src := makeTestSource(t)

	summary, err := Backup(ctx, repo, []string{src}, BackupOpts{}, nil)
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}

	// Ls — should return at least one node (the root or a file under src).
	nodes, err := Ls(ctx, repo, summary.SnapshotID, "")
	if err != nil {
		t.Fatalf("Ls: %v", err)
	}
	if len(nodes) == 0 {
		t.Error("Ls: expected at least one file node")
	}

	// Restore to a fresh target
	target := filepath.Join(t.TempDir(), "restore")
	if err := Restore(ctx, repo, summary.SnapshotID, target, nil); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	// Verify hello.txt was restored
	restored := filepath.Join(target, src, "hello.txt")
	data, err := os.ReadFile(restored)
	if err != nil {
		t.Fatalf("restored file missing: %v", err)
	}
	if string(data) != "hello world" {
		t.Errorf("restored content mismatch: %q", string(data))
	}
}

func TestForgetEmptyPolicyRejected(t *testing.T) {
	repo := setupTest(t)
	ctx := context.Background()
	if err := InitRepo(ctx, repo, "test-password-1234"); err != nil {
		t.Fatalf("InitRepo: %v", err)
	}
	if err := Forget(ctx, repo, RetentionPolicy{}, false); err == nil {
		t.Error("Forget with empty policy must fail")
	}
}

func TestStatsAndCheck(t *testing.T) {
	repo := setupTest(t)
	ctx := context.Background()
	if err := InitRepo(ctx, repo, "test-password-1234"); err != nil {
		t.Fatalf("InitRepo: %v", err)
	}
	src := makeTestSource(t)
	if _, err := Backup(ctx, repo, []string{src}, BackupOpts{}, nil); err != nil {
		t.Fatalf("Backup: %v", err)
	}

	stats, err := RepoStats(ctx, repo)
	if err != nil {
		t.Fatalf("RepoStats: %v", err)
	}
	if stats.TotalSize <= 0 {
		t.Errorf("RepoStats: expected positive total size, got %d", stats.TotalSize)
	}

	if err := CheckRepo(ctx, repo, false); err != nil {
		t.Errorf("CheckRepo: %v", err)
	}
}
