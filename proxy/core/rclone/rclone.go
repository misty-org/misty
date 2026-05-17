package rclone

import (
	"net/http"
	"time"
)

var defaultRcloneConfig = &RcloneConfig{}

var defaultRcloneRCD = &RcloneRCD{
	Client: &http.Client{Timeout: 10 * time.Second},
	Addr:   "127.0.0.1:5572",
}

func Init() error {
	if err := defaultRcloneConfig.Init(); err != nil {
		return err
	}
	defaultRcloneRCD.BinaryPath = defaultRcloneConfig.RcloneBinaryPath
	defaultRcloneRCD.ConfigPath = defaultRcloneConfig.RcloneConfigFile
	return nil
}

func DefaultConfig() *RcloneConfig {
	return defaultRcloneConfig
}

func DefaultRCD(config *RcloneConfig) *RcloneRCD {
	if config != nil {
		defaultRcloneRCD.BinaryPath = config.RcloneBinaryPath
		defaultRcloneRCD.ConfigPath = config.RcloneConfigFile
	}
	return defaultRcloneRCD
}
