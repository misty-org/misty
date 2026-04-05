package rclone

import (
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

var initOnce sync.Once

func Init() {
	initOnce.Do(func() {
		home, _ := os.UserHomeDir()
		configPath := filepath.Join(home, "misty", "rclone.conf")

		// Ensure parent directory exists
		os.MkdirAll(filepath.Dir(configPath), 0700)

		// Set rclone config file path before installing
		_ = config.SetConfigPath(configPath)

		// Initialize the config file backend
		configfile.Install()

		// Set reasonable defaults for library use
		ci := fs.GetConfig(context.Background())
		ci.LogLevel = fs.LogLevelWarning
	})
}

func GetConfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "misty", "rclone.conf")
}
