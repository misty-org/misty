package rclone

import (
	"context"
	"fmt"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/rc"
)

// ListRemotes returns all configured remotes from rclone.conf.
func ListRemotes() []RemoteInfo {
	Init()
	sections := config.FileSections()
	remotes := make([]RemoteInfo, 0, len(sections))
	for _, name := range sections {
		t, _ := config.FileGetValue(name, "type")
		remotes = append(remotes, RemoteInfo{
			Name: name,
			Type: t,
		})
	}
	return remotes
}

// CreateRemote creates a new rclone remote.
//
// We pass All: false so rclone's updateRemote() enables AutoConfirm on the
// context. That makes backendConfigStep auto-answer every Option question
// with its Default value, which is exactly what we need for:
//   - OneDrive's "choose_type" (defaults to "onedrive")
//   - OneDrive's drive selection (defaults to the first drive in /me/drives)
//   - OneDrive's "Drive OK?" confirmation (defaults to true)
//   - Google Drive's scope / root / team drive questions
//
// NonInteractive stays false so rclone's interactive backendConfig runs the
// full state machine inline — OAuth (via local callback server) included —
// and persists drive_id + drive_type before returning.
func CreateRemote(ctx context.Context, name, providerType string, params map[string]string) error {
	Init()

	// Reject if a remote with this name already exists.
	for _, existing := range config.FileSections() {
		if existing == name {
			return fmt.Errorf("remote %q already exists", name)
		}
	}

	keyValues := rc.Params{}
	for k, v := range params {
		keyValues[k] = v
	}

	if _, err := config.CreateRemote(ctx, name, providerType, keyValues, config.UpdateRemoteOpt{
		All: false,
	}); err != nil {
		return fmt.Errorf("create remote: %w", err)
	}

	config.SaveConfig()
	return nil
}

// DeleteRemote removes a remote from rclone.conf.
func DeleteRemote(name string) {
	Init()
	config.DeleteRemote(name)
}

// GetRemoteType returns the provider type for a given remote name.
func GetRemoteType(name string) string {
	Init()
	t, _ := config.FileGetValue(name, "type")
	return t
}

// RemoteExists checks if a remote with the given name exists.
func RemoteExists(name string) bool {
	Init()
	for _, s := range config.FileSections() {
		if s == name {
			return true
		}
	}
	return false
}
