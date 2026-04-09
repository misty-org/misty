package restic

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// MinResticVersion is the lowest restic version misty supports. 0.16 is where
// the --json output for `backup` stabilized into the (status/summary/error)
// shape progress.go expects, and where compression became the default.
const MinResticVersion = "0.16.0"

var (
	initOnce       sync.Once
	binaryPath     string
	binaryError    error
	binaryVersion  string
	registryDir    string
)

// Init locates the restic binary, version-checks it, and prepares the on-disk
// state directory. Safe to call repeatedly.
func Init() error {
	initOnce.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil {
			binaryError = fmt.Errorf("locate home dir: %w", err)
			return
		}
		registryDir = filepath.Join(home, "misty", "restic")
		if err := os.MkdirAll(registryDir, 0700); err != nil {
			binaryError = fmt.Errorf("create registry dir: %w", err)
			return
		}
		if err := os.MkdirAll(filepath.Join(registryDir, "passwords"), 0700); err != nil {
			binaryError = fmt.Errorf("create passwords dir: %w", err)
			return
		}

		path, err := exec.LookPath("restic")
		if err != nil {
			binaryError = fmt.Errorf("restic binary not found in PATH: %w", err)
			return
		}
		binaryPath = path

		out, err := exec.Command(binaryPath, "version").Output()
		if err != nil {
			binaryError = fmt.Errorf("restic version: %w", err)
			return
		}
		binaryVersion = parseVersion(string(out))
		if !versionAtLeast(string(out), MinResticVersion) {
			binaryError = fmt.Errorf("restic %s or newer required, found: %s",
				MinResticVersion, strings.TrimSpace(string(out)))
			return
		}
	})
	return binaryError
}

// Version returns the parsed restic version string ("0.18.1") if Init has
// run successfully. Returns "" if restic is not available.
func Version() string { return binaryVersion }

// BinaryPath returns the resolved restic binary path. Init must have succeeded.
func BinaryPath() string { return binaryPath }

// RegistryDir returns the directory misty uses for restic state.
func RegistryDir() string { return registryDir }

func registryPath() string { return filepath.Join(registryDir, "repos.json") }

// LoadRegistry reads the on-disk repo registry. Returns an empty slice if the
// file doesn't exist yet.
func LoadRegistry() ([]RepoConfig, error) {
	if err := Init(); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(registryPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []RepoConfig{}, nil
		}
		return nil, err
	}
	var repos []RepoConfig
	if err := json.Unmarshal(data, &repos); err != nil {
		return nil, fmt.Errorf("parse repos.json: %w", err)
	}
	return repos, nil
}

// SaveRegistry persists the repo list to disk atomically.
func SaveRegistry(repos []RepoConfig) error {
	if err := Init(); err != nil {
		return err
	}
	data, err := json.MarshalIndent(repos, "", "  ")
	if err != nil {
		return err
	}
	tmp := registryPath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, registryPath())
}

// parseVersion extracts the X.Y.Z token from "restic X.Y.Z ..." output. Returns
// "" if the line doesn't parse — callers should fall back to "unknown".
func parseVersion(versionOutput string) string {
	fields := strings.Fields(versionOutput)
	if len(fields) < 2 {
		return ""
	}
	return fields[1]
}

// versionAtLeast parses the "restic X.Y.Z ..." line from `restic version` and
// compares against the minimum.
func versionAtLeast(versionOutput, min string) bool {
	v := parseVersion(versionOutput)
	if v == "" {
		return false
	}
	return compareSemver(v, min) >= 0
}

func compareSemver(a, b string) int {
	aParts := strings.Split(strings.SplitN(a, "-", 2)[0], ".")
	bParts := strings.Split(strings.SplitN(b, "-", 2)[0], ".")
	for i := 0; i < 3; i++ {
		var av, bv int
		if i < len(aParts) {
			av, _ = strconv.Atoi(aParts[i])
		}
		if i < len(bParts) {
			bv, _ = strconv.Atoi(bParts[i])
		}
		if av != bv {
			if av < bv {
				return -1
			}
			return 1
		}
	}
	return 0
}
