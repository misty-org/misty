package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/kannachi323/misty/proxy/core/rclone"
	"github.com/kannachi323/misty/proxy/db"
)

const (
	defaultCommandsSeed = `# Misty keyboard commands
# Runtime source of truth: ~/misty/config/commands.msy
# Format: command.id = Shortcut
# Modifiers: Cmd, Ctrl, Shift, Alt

search.toggle = Ctrl+K
search.cancel = Escape
search.confirm = Enter
search.prev = Up
search.next = Down
explorer.copy = Ctrl+C
explorer.cut = Ctrl+X
explorer.paste = Ctrl+V
explorer.delete = Delete
explorer.rename = F2
explorer.refresh = Ctrl+R
explorer.toggle_chat = Ctrl+J
explorer.toggle_claude = Ctrl+Shift+A
explorer.new_tab = Ctrl+T
explorer.restore_tab = Ctrl+Shift+T
explorer.close_pane = Ctrl+W
explorer.restore_pane = Ctrl+Ctrl+Backslash
explorer.split_vertical = Ctrl+Backslash
explorer.split_horizontal = Ctrl+Shift+Backslash
explorer.tab_1 = Ctrl+1
explorer.tab_2 = Ctrl+2
explorer.tab_3 = Ctrl+3
explorer.tab_4 = Ctrl+4
explorer.tab_5 = Ctrl+5
explorer.tab_6 = Ctrl+6
explorer.tab_7 = Ctrl+7
explorer.tab_8 = Ctrl+8
explorer.tab_9 = Ctrl+9
app.open_settings = Ctrl+Comma
auth.submit = Enter
modal.confirm = Enter
modal.cancel = Escape
`
	defaultLLMConfigSeed = "{\n  \"api_url\": \"https://api.openai.com/v1/chat/completions\",\n  \"model\": \"\",\n  \"api_key\": \"\"\n}\n"
	defaultClaudeProfilesSeed = "{\n  \"selected_profile_index\": -1,\n  \"profiles\": []\n}\n"
)

func ensureMistyHomeLayout() error {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return fmt.Errorf("resolve user home directory: %w", err)
	}

	root := filepath.Join(home, "misty")
	dirs := []string{
		root,
		filepath.Join(root, ".cache"),
		filepath.Join(root, ".cache", "listings"),
		filepath.Join(root, ".cache", "trash"),
		filepath.Join(root, "config"),
		filepath.Join(root, "db"),
		filepath.Join(root, "mnt"),
		filepath.Join(root, "tailscale"),
		filepath.Join(root, "minidfs", "tailscale"),
		filepath.Join(root, "restic"),
		filepath.Join(root, "restic", "passwords"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}

	seedFiles := map[string]string{
		filepath.Join(root, "remotes.json"):                 "{\n  \"remotes\": {}\n}\n",
		filepath.Join(root, "restic", "repos.json"):         "[]\n",
		filepath.Join(root, "rclone.conf"):                  "",
		filepath.Join(root, "config", "commands.msy"):       defaultCommandsSeed,
		filepath.Join(root, "config", "llm.json"):           defaultLLMConfigSeed,
		filepath.Join(root, "config", "claude_profiles.json"): defaultClaudeProfilesSeed,
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

func ensureBootstrapLayout() error {
	if err := ensureMistyHomeLayout(); err != nil {
		return err
	}

	rclone.Init()

	return nil
}

func ensureBootstrapDatabase() error {
	database := &db.Database{}
	if err := database.StartDatabase(); err != nil {
		return err
	}
	database.Stop()

	return nil
}

func ensureBootstrapState() error {
	if err := ensureBootstrapLayout(); err != nil {
		return err
	}
	return ensureBootstrapDatabase()
}
