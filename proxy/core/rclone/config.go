package rclone

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type RcloneConfig struct {
	startup sync.Once
	mu      sync.Mutex

	RcloneConfigFile  string
	RcloneConfigDir   string
	RcloneBinaryPath  string
	OAuthTemplatePath string
	Err               error
}

func (rc *RcloneConfig) Init() error {
	rc.startup.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			rc.Err = fmt.Errorf("locate home dir: %w", err)
			return
		}

		rc.mu.Lock()
		rc.RcloneConfigDir = filepath.Join(home, "misty", "rclone")
		rc.RcloneConfigFile = filepath.Join(rc.RcloneConfigDir, "rclone.conf")
		rc.RcloneBinaryPath = filepath.Join(rc.RcloneConfigDir, "rclone")
		rc.mu.Unlock()

		if rc.OAuthTemplatePath == "" {
			rc.OAuthTemplatePath = filepath.Join(rc.RcloneConfigDir, "oauth_callback.html")
		}

		if err := rc.configRequirements(); err != nil {
			rc.Err = err
			return
		}
	})
	return rc.Err
}

func (rc *RcloneConfig) configRequirements() error {
	if err := rc.checkRcloneDir(); err != nil {
		return err
	}
	if err := rc.checkBinary(); err != nil {
		return err
	}
	if err := rc.checkConfig(); err != nil {
		return err
	}
	if err := rc.checkOAuthTemplate(); err != nil {
		return err
	}

	return nil
}

func (rc *RcloneConfig) checkBinary() error {
	if _, err := os.Stat(rc.RcloneBinaryPath); err == nil {
		return nil
	}
	return fmt.Errorf("rclone binary not found: %s", rc.RcloneBinaryPath)
}

func (rc *RcloneConfig) checkRcloneDir() error {
	if _, err := os.Stat(rc.RcloneConfigDir); err == nil {
		return nil
	}
	return os.MkdirAll(rc.RcloneConfigDir, 0o700)
}

func (rc *RcloneConfig) checkConfig() error {
	if _, err := os.Stat(rc.RcloneConfigFile); err == nil {
		return nil
	}
	return fmt.Errorf("rclone config not found: %s", rc.RcloneConfigFile)
}

func (rc *RcloneConfig) checkOAuthTemplate() error {
	if _, err := os.Stat(rc.OAuthTemplatePath); err == nil {
		return nil
	}
	return fmt.Errorf("oauth template not found: %s", rc.OAuthTemplatePath)
}
