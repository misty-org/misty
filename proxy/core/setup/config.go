// very simple config logic that just creates or loads ~/misty/config/misty.json
//
// Matthew Chen (kannachi323)

package setup

import (
	_ "embed"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

//go:embed default/misty.json
var defaultConfigSeed []byte

type Config struct {
	Proxy struct {
		Port int `json:"port"`
	} `json:"proxy"`

	Server struct {
		URL string `json:"url"`
	} `json:"server"`
}

func HomeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", errors.New("could not determine user home directory")
	}
	return home, nil
}

func Path() (string, error) {
	home, err := HomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "misty", "config", "misty.json"), nil
}

func Load() (Config, bool, error) {
	path, err := Path()
	if err != nil {
		return Config{}, false, err
	}
	body, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg, err := loadDefaultConfig()
			return cfg, false, err
		}
		return Config{}, false, err
	}

	cfg, err := decodeConfig(body)
	if err != nil {
		return Config{}, true, err
	}
	return cfg, true, nil
}

func loadDefaultConfig() (Config, error) {
	return decodeConfig(defaultConfigSeed)
}

func decodeConfig(body []byte) (Config, error) {
	var cfg Config
	if err := json.Unmarshal(body, &cfg); err != nil {
		return Config{}, err
	}

	normalizePort(&cfg)
	return cfg, nil
}

func normalizePort(cfg *Config) {
	if cfg.Proxy.Port == 0 {
		cfg.Proxy.Port = 3000
	}
}

func Save(cfg Config) ([]string, error) {
	path, err := Path()
	if err != nil {
		return nil, err
	}
	parent := filepath.Dir(path)
	var created []string
	if err := os.MkdirAll(parent, 0700); err != nil {
		return nil, err
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		created = append(created, path)
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return nil, err
	}
	return created, nil
}

type RuntimeCheck struct {
	Created []string `json:"created"`
}

func EnsureRuntimeLayout() (RuntimeCheck, error) {
	home, err := HomeDir()
	if err != nil {
		return RuntimeCheck{}, err
	}

	paths := []string{
		filepath.Join(home, "misty", "config"),
		filepath.Join(home, "misty", ".cache"),
		filepath.Join(home, "misty", "config", "sessions"),
		filepath.Join(home, "misty", "mnt"),
		filepath.Join(home, "misty", "db"),
		filepath.Join(home, "misty", "tmp"),
		filepath.Join(home, "misty", "public", "keys"),
		filepath.Join(home, "misty", "public", "plugins"),
		filepath.Join(home, "misty", "local", "plugins"),
	}

	var created []string
	for _, p := range paths {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			if err := os.MkdirAll(p, 0700); err != nil {
				return RuntimeCheck{}, err
			}
			created = append(created, p)
		} else if err == nil {
			// exists
		} else {
			return RuntimeCheck{}, err
		}
	}

	return RuntimeCheck{Created: created}, nil
}
