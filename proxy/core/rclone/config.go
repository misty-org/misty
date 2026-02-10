package rclone

import (
	_ "embed"
	"context"
	"os"
	"path/filepath"
	"sync"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"

	// Register only the backends we need
	_ "github.com/rclone/rclone/backend/drive"
	_ "github.com/rclone/rclone/backend/dropbox"
	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/onedrive"
	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"
)

//go:embed assets/oauth_callback.html
var oauthCallbackHTML []byte

var (
	initOnce            sync.Once
	oauthTemplatePath   string
)

func Init() {
	initOnce.Do(func() {
		home, _ := os.UserHomeDir()
		mistyDir := filepath.Join(home, "misty")
		configPath := filepath.Join(mistyDir, "rclone.conf")

		// Ensure parent directory exists
		os.MkdirAll(mistyDir, 0700)

		// Set rclone config file path before installing
		_ = config.SetConfigPath(configPath)

		// Initialize the config file backend
		configfile.Install()

		// Materialize the embedded OAuth callback template to disk so rclone
		// can read it via config_template_file. We rewrite on every start so
		// updates ship with the binary.
		tmplPath := filepath.Join(mistyDir, "oauth_callback.html")
		if err := os.WriteFile(tmplPath, oauthCallbackHTML, 0600); err == nil {
			oauthTemplatePath = tmplPath
		}

		// Set reasonable defaults for library use
		ci := fs.GetConfig(context.Background())
		ci.LogLevel = fs.LogLevelWarning
	})
}

func GetConfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "misty", "rclone.conf")
}

// OAuthTemplatePath returns the on-disk path to the embedded OAuth callback
// HTML template, or "" if it could not be materialized.
func OAuthTemplatePath() string {
	return oauthTemplatePath
}
