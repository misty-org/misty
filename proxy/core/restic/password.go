package restic

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"github.com/zalando/go-keyring"
)

// keyringService is the namespace under which all misty vault repo
// passwords live in the OS keyring. Each repo is one keyring entry keyed
// by its name.
const keyringService = "misty-vault"

var (
	helperOnce    sync.Once
	helperBinPath string
)

// StorePassword persists a repo password. Storage backend is chosen at
// call time:
//
//   - If the misty-pwd-helper binary is available, the password is written
//     to the OS keyring under (keyringService, repoName). restic later
//     reads it back via --password-command + the helper.
//   - Otherwise the password lands in a 0600 file under the registry dir
//     (the dev fallback). This keeps tests and bare-bones installs working
//     without dragging in libsecret/dbus.
//
// Either way, after this returns successfully there is exactly one source
// of truth for the password.
func StorePassword(repoName, password string) error {
	if repoName == "" {
		return fmt.Errorf("repo name is required")
	}
	if err := Init(); err != nil {
		return err
	}
	repo := RepoConfig{Name: repoName}

	if HelperBinaryPath() != "" {
		if err := keyring.Set(keyringService, repoName, password); err == nil {
			// Drop any stale fallback file so we don't leak the password to
			// disk after migrating an entry into the keyring.
			_ = os.Remove(passwordFileFor(repo))
			return nil
		}
		// Fall through to the file fallback if the keyring write failed
		// (no secret service running, locked keyring, etc.).
	}
	return writePasswordFile(repo, password)
}

// LoadPassword retrieves a repo password from whichever backend currently
// holds it. The misty-pwd-helper binary calls this; resticCmd does not (it
// hands restic a command/file path instead).
func LoadPassword(repoName string) (string, error) {
	if repoName == "" {
		return "", fmt.Errorf("repo name is required")
	}
	if err := Init(); err != nil {
		return "", err
	}

	if HelperBinaryPath() != "" {
		pw, err := keyring.Get(keyringService, repoName)
		if err == nil {
			return pw, nil
		}
		if !errors.Is(err, keyring.ErrNotFound) {
			// Real backend error — log via stderr would happen in the
			// helper binary, not here. Fall through to file fallback.
		}
	}

	data, err := os.ReadFile(passwordFileFor(RepoConfig{Name: repoName}))
	if err != nil {
		return "", fmt.Errorf("password not found for repo %q: %w", repoName, err)
	}
	return string(data), nil
}

// DeletePassword removes a repo password from both backends. Best-effort —
// errors are ignored because the caller (DeleteRepo) succeeds whether or
// not the credential cleanup lands.
func DeletePassword(repoName string) {
	if repoName == "" {
		return
	}
	_ = keyring.Delete(keyringService, repoName)
	_ = os.Remove(passwordFileFor(RepoConfig{Name: repoName}))
}

// HelperBinaryPath locates the misty-pwd-helper binary. Lookup order:
//
//  1. $MISTY_PWD_HELPER (explicit override; useful for tests and packaged
//     builds where the helper sits outside PATH).
//  2. ./misty-pwd-helper next to the running executable.
//  3. PATH.
//
// Returns "" if not found. Cached after the first call.
func HelperBinaryPath() string {
	helperOnce.Do(func() {
		if env := os.Getenv("MISTY_PWD_HELPER"); env != "" {
			if _, err := os.Stat(env); err == nil {
				helperBinPath = env
				return
			}
		}
		if exe, err := os.Executable(); err == nil {
			candidate := filepath.Join(filepath.Dir(exe), "misty-pwd-helper")
			if _, err := os.Stat(candidate); err == nil {
				helperBinPath = candidate
				return
			}
		}
		if p, err := exec.LookPath("misty-pwd-helper"); err == nil {
			helperBinPath = p
			return
		}
	})
	return helperBinPath
}

// useKeyringFor reports whether resticCmd should pass --password-command
// (keyring path) or --password-file (file fallback) for the given repo.
// Both the helper binary and a keyring entry must be present.
func useKeyringFor(repoName string) bool {
	if HelperBinaryPath() == "" {
		return false
	}
	_, err := keyring.Get(keyringService, repoName)
	return err == nil
}
