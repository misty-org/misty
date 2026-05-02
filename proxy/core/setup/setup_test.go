package setup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureSetupCreatesRuntimeLayout(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	if err := EnsureSetup(); err != nil {
		t.Fatalf("EnsureSetup() error = %v", err)
	}

	requiredPaths := []string{
		filepath.Join(home, "misty", ".cache", "remotes"),
		filepath.Join(home, "misty", ".cache", "trash"),
		filepath.Join(home, "misty", "config"),
		filepath.Join(home, "misty", "config", "misty.json"),
		filepath.Join(home, "misty", "db"),
		filepath.Join(home, "misty", "rclone", "remotes.json"),
		filepath.Join(home, "misty", "restic", "repos.json"),
		filepath.Join(home, "misty", "config", "commands.msy"),
	}

	for _, path := range requiredPaths {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("Stat(%q) error = %v", path, err)
		}
	}
}
