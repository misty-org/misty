package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"

	"github.com/kannachi323/misty/proxy/core/mistyconfig"
)

type ReadyResponse struct {
	OK            bool     `json:"ok"`
	Created       []string `json:"created"`
	ConfigCreated []string `json:"config_created"`
	ConfigPath    string   `json:"config_path"`
	ConfigExisted bool     `json:"config_existed"`
	Warnings      []string `json:"warnings"`
}

func Ready(proxyPort int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var warnings []string

		layout, err := mistyconfig.EnsureRuntimeLayout()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		cfg, existed, err := mistyconfig.Load()
		if err != nil && existed {
			// Bad JSON: don't overwrite; report.
			warnings = append(warnings, "misty.json exists but could not be parsed")
		}
		// Mirror the actual running proxy port into config (port is chosen by the
		// client loader / caller).
		if proxyPort != 0 && cfg.Proxy.Port != proxyPort {
			cfg.Proxy.Port = proxyPort
		}
		if cfg.Proxy.Port == 0 {
			cfg.Proxy.Port = 3000
		}

		if cfg.Server.URL == "" {
			if env := os.Getenv("MISTY_SERVER_URL"); env != "" {
				cfg.Server.URL = env
			}
		}
		if cfg.SSL.CertPath == "" {
			if env := os.Getenv("SSL_CERT_PATH"); env != "" {
				cfg.SSL.CertPath = env
			}
		}

		configCreated, saveErr := mistyconfig.Save(cfg)
		if saveErr != nil {
			http.Error(w, saveErr.Error(), http.StatusInternalServerError)
			return
		}
		mistyconfig.ApplyEnv(cfg)

		configPath, _ := mistyconfig.Path()
		created := layout.Created
		if created == nil {
			created = []string{}
		}
		if warnings == nil {
			warnings = []string{}
		}
		if configCreated == nil {
			configCreated = []string{}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ReadyResponse{
			OK:            true,
			Created:       created,
			ConfigCreated: configCreated,
			ConfigPath:    configPath,
			ConfigExisted: existed,
			Warnings:      warnings,
		})
	}
}

func ParsePort(value string) int {
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 || n > 65535 {
		return 0
	}
	return n
}
