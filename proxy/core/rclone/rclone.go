package rclone

import (
	"context"
	"net/http"
	"strings"
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

type HealthStatus struct {
	Ready              bool   `json:"ready"`
	Error              string `json:"error,omitempty"`
	Addr               string `json:"addr,omitempty"`
	Port               string `json:"port,omitempty"`
	ConfigPath         string `json:"config_path,omitempty"`
	StartedAt          string `json:"started_at,omitempty"`
	UptimeSeconds      int64  `json:"uptime_seconds,omitempty"`
	ConnectedProviders int    `json:"connected_providers"`
	AvailableProviders int    `json:"available_providers"`
}

func GetHealthStatus(ctx context.Context) HealthStatus {
	status := HealthStatus{}
	if err := Init(); err != nil {
		status.Error = err.Error()
		return status
	}
	if err := defaultRcloneRCD.Start(); err != nil {
		status.Error = err.Error()
		info := defaultRcloneRCD.RuntimeInfo()
		status.Addr = info.Addr
		status.ConfigPath = info.ConfigPath
		if port := portFromAddr(info.Addr); port != "" {
			status.Port = port
		}
		return status
	}

	info := defaultRcloneRCD.RuntimeInfo()
	status.Ready = info.Ready
	status.Error = info.LastError
	status.Addr = info.Addr
	status.ConfigPath = info.ConfigPath
	status.UptimeSeconds = info.UptimeSeconds
	if !info.StartedAt.IsZero() {
		status.StartedAt = info.StartedAt.Format(time.RFC3339)
	}
	if port := portFromAddr(info.Addr); port != "" {
		status.Port = port
	}

	if remotes, err := ListRemotes(ctx); err == nil {
		status.ConnectedProviders = len(remotes)
	}
	if workflows, err := ListProviderWorkflows(ctx); err == nil {
		status.AvailableProviders = len(workflows)
	}

	return status
}

func portFromAddr(addr string) string {
	if i := strings.LastIndex(strings.TrimSpace(addr), ":"); i >= 0 && i+1 < len(strings.TrimSpace(addr)) {
		return strings.TrimSpace(addr)[i+1:]
	}
	return ""
}
