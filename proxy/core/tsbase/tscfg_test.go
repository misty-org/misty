package tsbase

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfigSeedsMissingFiles(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	configPath := GetConfigPath()
	secretPath := GetConfigSecretPath()

	config, err := LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if config == nil {
		t.Fatal("LoadConfig() returned nil config")
	}
	if config.BaseName == "" {
		t.Fatal("LoadConfig() returned empty BaseName")
	}
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("config file missing: %v", err)
	}
	if _, err := os.Stat(secretPath); err != nil {
		t.Fatalf("secret file missing: %v", err)
	}

	expectedDir := filepath.Join(home, "misty", "tailscale")
	if filepath.Dir(configPath) != expectedDir {
		t.Fatalf("config dir = %q, want %q", filepath.Dir(configPath), expectedDir)
	}
}
