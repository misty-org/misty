package setup

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/kannachi323/misty/proxy/db"
)

//go:embed default/commands.msy
var defaultCommandsSeed string

func ensureLayout() error {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return fmt.Errorf("resolve user home directory: %w", err)
	}

	misty := filepath.Join(home, "misty")
	dirs := []string{
		misty,
		filepath.Join(misty, ".cache"),
		filepath.Join(misty, ".cache", "remotes"),
		filepath.Join(misty, ".cache", "trash"),
		filepath.Join(misty, "config"),
		filepath.Join(misty, "config", "sessions"),
		filepath.Join(misty, "db"),
		filepath.Join(misty, "mnt"),
		filepath.Join(misty, "tmp"),
		filepath.Join(misty, "rclone"),
		filepath.Join(misty, "restic"),
		filepath.Join(misty, "restic", "passwords"),
		filepath.Join(misty, "public"),
		filepath.Join(misty, "public", "keys"),
		filepath.Join(misty, "public", "plugins"),
		filepath.Join(misty, "local"),
		filepath.Join(misty, "local", "plugins"),
	}

	//proxy creates all the required directories
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}

	seedFiles := map[string]string{
		filepath.Join(misty, "rclone", "remotes.json"): "{\n  \"remotes\": {}\n}\n",
		filepath.Join(misty, "restic", "repos.json"):   "[]\n",
		filepath.Join(misty, "rclone", "rclone.conf"):  "",
		filepath.Join(misty, "config", "misty.json"):   string(defaultConfigSeed),
		filepath.Join(misty, "config", "commands.msy"): defaultCommandsSeed,
	}
	for path, body := range seedFiles {
		if _, err := os.Stat(path); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("stat %s: %w", path, err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			return fmt.Errorf("write %s: %w", path, err)
		}
	}

	return nil
}

func ensureDatabase() error {
	database := &db.Database{}
	if err := database.StartDatabase(); err != nil {
		return err
	}
	database.Stop()

	return nil
}

// to be called to set up EVERYTHING
func EnsureSetup() error {
	if err := ensureLayout(); err != nil {
		return err
	}
	if err := ensureDatabase(); err != nil {
		return err
	}
	return nil
}
