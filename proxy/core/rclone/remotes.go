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

// CreateRemote creates a new rclone remote. For OAuth providers, this opens the
// user's browser and blocks until the OAuth flow completes. The caller should
// run this in a goroutine if non-blocking behavior is desired.
//
// params can include provider-specific config like client_id, client_secret, etc.
func CreateRemote(ctx context.Context, name, providerType string, params map[string]string) error {
	Init()

	// Check if remote already exists
	for _, existing := range config.FileSections() {
		if existing == name {
			return fmt.Errorf("remote %q already exists", name)
		}
	}

	// Build the key-value pairs for config
	keyValues := rc.Params{}
	for k, v := range params {
		keyValues[k] = v
	}

	// config.CreateRemote handles OAuth interactively (opens browser)
	_, err := config.CreateRemote(ctx, name, providerType, keyValues, config.UpdateRemoteOpt{})
	return err
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
