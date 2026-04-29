package mistyconfig

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type Config struct {
	Proxy struct {
		Port int    `json:"port"`
		Path string `json:"path"`
	} `json:"proxy"`

	GRPC struct {
		Address string `json:"address"`
	} `json:"grpc"`

	Mount struct {
		Path string `json:"path"`
	} `json:"mount"`

	Server struct {
		URL string `json:"url"`
	} `json:"server"`

	SSL struct {
		CertPath string `json:"cert_path"`
	} `json:"ssl"`

	License struct {
		Secret string `json:"secret"`
	} `json:"license"`

	AI struct {
		APIKey  string `json:"api_key"`
		Model   string `json:"model"`
		BaseURL string `json:"base_url"`
	} `json:"ai"`
}

func Default() Config {
	var cfg Config
	cfg.Proxy.Port = 3000
	cfg.GRPC.Address = "localhost:50051"
	cfg.Mount.Path = "misty"
	return cfg
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
			return Default(), false, nil
		}
		return Config{}, false, err
	}

	var cfg Config
	if err := json.Unmarshal(body, &cfg); err != nil {
		return Config{}, true, err
	}

	if cfg.Proxy.Port == 0 {
		cfg.Proxy.Port = 3000
	}
	if cfg.GRPC.Address == "" {
		cfg.GRPC.Address = "localhost:50051"
	}
	if cfg.Mount.Path == "" {
		cfg.Mount.Path = "misty"
	}

	return cfg, true, nil
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

// ApplyEnv sets process environment variables from cfg fields, without
// overwriting values already present in the environment (process env wins).
func ApplyEnv(cfg Config) {
	set := func(key, val string) {
		if val != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, val)
		}
	}
	set("MISTY_SERVER_URL", cfg.Server.URL)
	set("SSL_CERT_PATH", cfg.SSL.CertPath)
	set("LICENSE_SECRET", cfg.License.Secret)
	set("GEMINI_API_KEY", cfg.AI.APIKey)
	set("MISTY_AI_MODEL", cfg.AI.Model)
	set("MISTY_AI_BASE_URL", cfg.AI.BaseURL)
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
		filepath.Join(home, "misty", "mnt"),
		filepath.Join(home, "misty", "db"),
		filepath.Join(home, "misty", "tmp"),
		filepath.Join(home, "misty", "public", "keys"),
		filepath.Join(home, "misty", "public", "plugins"),
		filepath.Join(home, "misty", "local", "plugins"),
		filepath.Join(home, ".misty"),
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
