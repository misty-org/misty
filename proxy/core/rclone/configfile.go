package rclone

import (
	"bufio"
	"fmt"
	"os"
	"sort"
	"strings"
)

type remoteConfig map[string]map[string]string

func readConfig() (remoteConfig, error) {
	_ = Init()
	configMu.Lock()
	defer configMu.Unlock()
	return readConfigLocked()
}

func readConfigLocked() (remoteConfig, error) {
	remotes := remoteConfig{}
	file, err := os.Open(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return remotes, nil
		}
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	current := ""
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			current = strings.TrimSpace(line[1 : len(line)-1])
			if current != "" {
				if _, ok := remotes[current]; !ok {
					remotes[current] = map[string]string{}
				}
			}
			continue
		}
		if current == "" {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		remotes[current][strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return remotes, nil
}

func writeConfig(remotes remoteConfig) error {
	_ = Init()
	configMu.Lock()
	defer configMu.Unlock()
	return writeConfigLocked(remotes)
}

func writeConfigLocked(remotes remoteConfig) error {
	names := make([]string, 0, len(remotes))
	for name := range remotes {
		names = append(names, name)
	}
	sort.Strings(names)

	var b strings.Builder
	for _, name := range names {
		if strings.TrimSpace(name) == "" {
			continue
		}
		b.WriteString("[")
		b.WriteString(name)
		b.WriteString("]\n")

		keys := make([]string, 0, len(remotes[name]))
		for key := range remotes[name] {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if strings.TrimSpace(key) == "" {
				continue
			}
			b.WriteString(key)
			b.WriteString(" = ")
			b.WriteString(remotes[name][key])
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	tmp := configPath + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, configPath)
}

func getConfigValue(name, key string) (string, bool) {
	remotes, err := readConfig()
	if err != nil {
		return "", false
	}
	values, ok := remotes[name]
	if !ok {
		return "", false
	}
	value, ok := values[key]
	return value, ok
}

func setConfigValue(name, key, value string) error {
	if !validRemoteName(name) {
		return fmt.Errorf("invalid remote name %q", name)
	}
	configMu.Lock()
	defer configMu.Unlock()
	if err := ensureConfigFile(); err != nil {
		return err
	}
	remotes, err := readConfigLocked()
	if err != nil {
		return err
	}
	values := remotes[name]
	if values == nil {
		values = map[string]string{}
		remotes[name] = values
	}
	values[key] = value
	return writeConfigLocked(remotes)
}

func unsetConfigValue(name, key string) error {
	if !validRemoteName(name) {
		return fmt.Errorf("invalid remote name %q", name)
	}
	configMu.Lock()
	defer configMu.Unlock()
	if err := ensureConfigFile(); err != nil {
		return err
	}
	remotes, err := readConfigLocked()
	if err != nil {
		return err
	}
	values := remotes[name]
	if values == nil {
		return nil
	}
	delete(values, key)
	return writeConfigLocked(remotes)
}

func validRemoteName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || strings.Contains(name, ":") {
		return false
	}
	for _, r := range name {
		switch r {
		case '/', '\\', '[', ']', '\n', '\r', '\t':
			return false
		}
	}
	return true
}

func makeConfigName(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '@' || r == '.' || r == '_' || r == '-' || r == '+':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-.")
	if out == "" {
		return "remote"
	}
	return out
}
