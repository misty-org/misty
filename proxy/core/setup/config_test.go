package setup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingConfigReturnsEmptyConfig(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	cfg, existed, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if existed {
		t.Fatal("Load() existed = true, want false")
	}
	if cfg.Proxy.Port != 3000 {
		t.Fatalf("Load() proxy port = %d, want 3000 from default config", cfg.Proxy.Port)
	}
	if cfg.Server.URL != "https://mistysys.com" {
		t.Fatalf("Load() server url = %q, want %q", cfg.Server.URL, "https://mistysys.com")
	}
}

func TestLoadNormalizesPortFromExistingConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	configPath := filepath.Join(home, "misty", "config", "misty.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	body := []byte("{\n  \"proxy\": {},\n  \"server\": {\"url\": \"https://example.test\"}\n}\n")
	if err := os.WriteFile(configPath, body, 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	cfg, existed, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !existed {
		t.Fatal("Load() existed = false, want true")
	}
	if cfg.Proxy.Port != 3000 {
		t.Fatalf("Load() proxy port = %d, want 3000", cfg.Proxy.Port)
	}
	if cfg.Server.URL != "https://example.test" {
		t.Fatalf("Load() server url = %q, want %q", cfg.Server.URL, "https://example.test")
	}
}
