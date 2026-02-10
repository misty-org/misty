package rclone

import (
	"context"
	"fmt"
	"log"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/fspath"
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

// RenameRemote moves all keys from oldName to newName and deletes oldName.
// Returns an error if newName is already taken or oldName doesn't exist.
// The caller should dedupe beforehand if it wants "rename over existing"
// semantics (see FinalizeRemoteName for an example).
func RenameRemote(oldName, newName string) error {
	Init()
	if oldName == newName {
		return nil
	}
	data := config.LoadedData()

	for _, existing := range data.GetSectionList() {
		if existing == newName {
			return fmt.Errorf("remote %q already exists", newName)
		}
	}

	keys := data.GetKeyList(oldName)
	if len(keys) == 0 {
		return fmt.Errorf("remote %q not found", oldName)
	}
	for _, k := range keys {
		if v, ok := data.GetValue(oldName, k); ok {
			data.SetValue(newName, k, v)
		}
	}
	data.DeleteSection(oldName)
	config.SaveConfig()
	return nil
}

// FinalizeRemoteName tries to rename a just-created remote from its
// throwaway name (e.g. "onedrive-1712345678") to the authenticated
// user's email (e.g. "alice@contoso.com"). The provider type is
// already reflected in the mount path's parent directory, so there's
// no need to repeat it in the name.
//
// Silently no-ops for backends without OAuth or when email resolution
// fails — the temp name stays in place.
//
// Collision handling:
//   - Same email, same provider → reconnect. Drop the stale section,
//     rename the fresh one into its slot so vault repos / pinned paths
//     that reference the stable name keep working.
//   - Same email, different provider → fall back to "<type>-<email>"
//     (e.g. a second account with the same email on Dropbox becomes
//     "dropbox-alice@contoso.com") so the two don't clash. The first
//     one to connect keeps the clean email-only name.
//
// Returns the final name of the remote (either the renamed one or,
// on any kind of failure, the original tempName).
func FinalizeRemoteName(ctx context.Context, tempName string) string {
	email, err := ResolveUserEmail(ctx, tempName)
	if err != nil {
		log.Printf("finalize remote %q: resolve email: %v", tempName, err)
		return tempName
	}
	if email == "" {
		return tempName
	}

	providerType, _ := config.FileGetValue(tempName, "type")
	if providerType == "" {
		return tempName
	}

	// Email characters (@, ., +) are already in rclone's allowed set, but
	// run through MakeConfigName in case the provider ever hands us
	// something exotic.
	newName := fspath.MakeConfigName(email)
	if newName == tempName {
		return tempName
	}

	if RemoteExists(newName) {
		existingType, _ := config.FileGetValue(newName, "type")
		switch {
		case existingType == providerType:
			// Reconnect: same account, fresh token. Replace in place.
			DeleteRemote(newName)
		default:
			// Cross-provider collision (e.g. alice@gmail.com on both
			// Drive and Dropbox). Fall back to "<type>-<email>" for
			// the newcomer; the existing entry keeps its clean name.
			fallback := fspath.MakeConfigName(providerType + "-" + email)
			if fallback == tempName {
				return tempName
			}
			if RemoteExists(fallback) {
				// Same provider + email as an existing <type>-<email>
				// section — treat as reconnect on the fallback name.
				DeleteRemote(fallback)
			}
			if err := RenameRemote(tempName, fallback); err != nil {
				log.Printf("finalize remote %q: rename to %q: %v", tempName, fallback, err)
				return tempName
			}
			return fallback
		}
	}

	if err := RenameRemote(tempName, newName); err != nil {
		log.Printf("finalize remote %q: rename to %q: %v", tempName, newName, err)
		return tempName
	}
	return newName
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
