package rclone

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

//go:embed assets/oauth_callback.html
var oauthCallbackHTML []byte

var (
	initOnce          sync.Once
	binaryMu          sync.Mutex
	configMu          sync.Mutex
	rcloneDir         string
	configPath        string
	binaryPath        string
	binaryError       error
	binaryVersion     string
	oauthTemplatePath string
)

// Init prepares Misty's rclone state directory and locates the external
// rclone binary. Callers that only read rclone.conf may ignore the returned
// binary error; operations that execute rclone should return it.
func Init() error {
	initOnce.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			binaryError = fmt.Errorf("locate home dir: %w", err)
			return
		}

		rcloneDir = filepath.Join(home, "misty", "rclone")
		if env := strings.TrimSpace(os.Getenv("MISTY_RCLONE_DIR")); env != "" {
			rcloneDir = env
		}
		configPath = filepath.Join(rcloneDir, "rclone.conf")
		if env := strings.TrimSpace(os.Getenv("MISTY_RCLONE_CONFIG")); env != "" {
			configPath = env
			rcloneDir = filepath.Dir(env)
		}

		if err := os.MkdirAll(rcloneDir, 0o700); err != nil {
			binaryError = fmt.Errorf("create rclone dir: %w", err)
			return
		}
		if err := ensureConfigFile(); err != nil {
			binaryError = err
			return
		}

		tmplPath := filepath.Join(rcloneDir, "oauth_callback.html")
		if err := os.WriteFile(tmplPath, oauthCallbackHTML, 0o600); err == nil {
			oauthTemplatePath = tmplPath
		}

		path, err := findRcloneBinary()
		if err != nil {
			binaryError = err
			return
		}
		binaryPath = path

		out, err := exec.Command(binaryPath, "version").Output()
		if err != nil {
			binaryError = fmt.Errorf("rclone version: %w", err)
			return
		}
		binaryVersion = parseRcloneVersion(string(out))
	})
	return binaryError
}

func ensureConfigFile() error {
	if _, err := os.Stat(configPath); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat rclone config: %w", err)
	}

	// One-time migration from the previous Misty path.
	home, _ := os.UserHomeDir()
	legacyPath := filepath.Join(home, "misty", "rclone.conf")
	if legacyPath != configPath {
		if data, err := os.ReadFile(legacyPath); err == nil && len(data) != 0 {
			return os.WriteFile(configPath, data, 0o600)
		}
	}
	return os.WriteFile(configPath, []byte(""), 0o600)
}

func binaryNameForPlatform(base string) string {
	if runtime.GOOS == "windows" {
		return base + ".exe"
	}
	return base
}

func findRcloneBinary() (string, error) {
	if env := strings.TrimSpace(os.Getenv("MISTY_RCLONE_PATH")); env != "" {
		if path, ok := executableCandidate(env); ok {
			return path, nil
		}
		return "", fmt.Errorf("MISTY_RCLONE_PATH does not point to an executable file: %s", env)
	}

	link := filepath.Join(rcloneDir, binaryNameForPlatform("rclone"))
	if path, ok := executableCandidate(link); ok {
		return path, nil
	}

	if path, ok := lookupPathBinary("rclone"); ok {
		return path, nil
	}
	for _, candidate := range installedBinaryCandidates() {
		if path, ok := executableCandidate(candidate); ok {
			return path, nil
		}
	}
	return "", fmt.Errorf("rclone binary not found (checked MISTY_RCLONE_PATH, %s, and PATH)", link)
}

func installedBinaryCandidates() []string {
	name := binaryNameForPlatform("rclone")
	home, _ := os.UserHomeDir()

	candidates := []string{
		filepath.Join("/usr/local/bin", name),
		filepath.Join("/usr/bin", name),
	}

	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", name),
			filepath.Join(home, "bin", name),
		)
	}

	switch runtime.GOOS {
	case "darwin":
		candidates = append(candidates,
			filepath.Join("/opt/homebrew/bin", name),
			filepath.Join("/opt/local/bin", name),
		)
	case "linux":
		candidates = append(candidates,
			filepath.Join("/snap/bin", "rclone"),
		)
	}

	return candidates
}

func executableCandidate(path string) (string, bool) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return "", false
	}
	if info.Mode()&0o111 == 0 {
		return "", false
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil {
		return resolved, true
	}
	return path, true
}

func lookupPathBinary(baseName string) (string, bool) {
	path, err := exec.LookPath(binaryNameForPlatform(baseName))
	if err != nil {
		path, err = exec.LookPath(baseName)
	}
	if err != nil {
		return "", false
	}
	return path, true
}

func parseRcloneVersion(versionOutput string) string {
	for _, field := range strings.Fields(versionOutput) {
		if strings.Count(field, ".") >= 1 && field[0] >= '0' && field[0] <= '9' {
			return strings.TrimPrefix(field, "v")
		}
	}
	return ""
}

func GetConfigPath() string {
	_ = Init()
	return configPath
}

func BinaryPath() string {
	_ = Init()
	_ = ensureBinaryAvailable()
	return binaryPath
}

func Version() string {
	_ = Init()
	_ = ensureBinaryAvailable()
	return binaryVersion
}

func LinkPath() string {
	_ = Init()
	return filepath.Join(rcloneDir, binaryNameForPlatform("rclone"))
}

type HealthStatus struct {
	Ready         bool   `json:"ready"`
	RclonePath    string `json:"rclone_path"`
	RcloneVersion string `json:"rclone_version"`
	ConfigPath    string `json:"config_path"`
	LinkPath      string `json:"link_path"`
	LinkTarget    string `json:"link_target"`
	LinkPresent   bool   `json:"link_present"`
	Error         string `json:"error,omitempty"`
}

func Health() HealthStatus {
	err := ensureBinaryAvailable()
	status := HealthStatus{
		Ready:         err == nil,
		RclonePath:    binaryPath,
		RcloneVersion: binaryVersion,
		ConfigPath:    GetConfigPath(),
		LinkPath:      LinkPath(),
	}
	if err != nil {
		status.Error = err.Error()
		return status
	}

	linkPresent, linkTarget, linkErr := ensureManagedLink()
	status.LinkPresent = linkPresent
	status.LinkTarget = linkTarget
	if linkErr != nil {
		status.Error = linkErr.Error()
	}
	return status
}

func ensureManagedLink() (bool, string, error) {
	linkPath := LinkPath()
	if linkPath == "" || binaryPath == "" {
		return false, "", nil
	}

	if resolved, ok := executableCandidate(linkPath); ok && resolved == binaryPath {
		return true, resolved, nil
	}

	info, err := os.Lstat(linkPath)
	if err == nil {
		if info.IsDir() {
			return false, "", fmt.Errorf("managed rclone link path is a directory: %s", linkPath)
		}
		if err := os.Remove(linkPath); err != nil {
			return false, "", fmt.Errorf("replace managed rclone link: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return false, "", fmt.Errorf("stat managed rclone link: %w", err)
	}

	if err := os.Symlink(binaryPath, linkPath); err != nil {
		return false, "", fmt.Errorf("create managed rclone link: %w", err)
	}
	return true, binaryPath, nil
}

func OAuthTemplatePath() string {
	_ = Init()
	return oauthTemplatePath
}
