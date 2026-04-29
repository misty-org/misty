package rclone

import (
	"context"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"unicode"
)

const defaultDriveImportFormats = "csv,doc,docx,htm,html,odp,ods,odt,ppt,pptx,rtf,tsv,txt,xls,xlsx"

var fallbackProviderTypes = []ProviderType{
	{Type: "local", Name: "Local"},
}

func desiredDriveImportFormats() string {
	if value := strings.TrimSpace(os.Getenv("MISTY_DRIVE_IMPORT_FORMATS")); value != "" {
		return value
	}
	return defaultDriveImportFormats
}

func normalizeCommaList(value string) string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.ToLower(strings.TrimSpace(part))
		if part == "" {
			continue
		}
		out = append(out, part)
	}
	return strings.Join(out, ",")
}

func EnsureRemoteDefaults(name string) error {
	if GetRemoteType(name) != "drive" {
		return nil
	}

	desired := desiredDriveImportFormats()
	if desired == "" {
		return nil
	}

	current, _ := getConfigValue(name, "import_formats")
	if normalizeCommaList(current) == normalizeCommaList(desired) {
		return nil
	}
	return setConfigValue(name, "import_formats", desired)
}

func EnsureAllRemoteDefaults() error {
	var errs []string
	for _, remote := range ListRemotes() {
		if err := EnsureRemoteDefaults(remote.Name); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", remote.Name, err))
		}
	}
	if len(errs) != 0 {
		return fmt.Errorf("ensure remote defaults: %s", strings.Join(errs, "; "))
	}
	return nil
}

func ListRemotes() []RemoteInfo {
	remotes, err := readConfig()
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(remotes))
	for name := range remotes {
		names = append(names, name)
	}
	sort.Strings(names)

	out := make([]RemoteInfo, 0, len(names))
	for _, name := range names {
		out = append(out, RemoteInfo{
			Name: name,
			Type: remotes[name]["type"],
		})
	}
	return out
}

func ListProviderTypes() []ProviderType {
	providers, err := providerTypesFromBinary(context.Background())
	if err == nil && len(providers) != 0 {
		return providers
	}
	return append([]ProviderType(nil), fallbackProviderTypes...)
}

func providerTypesFromBinary(ctx context.Context) ([]ProviderType, error) {
	out, err := runRclone(ctx, "help", "backends")
	if err != nil {
		return nil, err
	}

	seen := map[string]struct{}{}
	var providers []ProviderType
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "\t") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[0]
		if !looksLikeBackendName(name) {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		desc := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), name))
		if desc == "" {
			desc = name
		}
		providers = append(providers, ProviderType{Type: name, Name: desc})
	}
	sort.Slice(providers, func(i, j int) bool {
		return strings.ToLower(providers[i].Name) < strings.ToLower(providers[j].Name)
	})
	return providers, nil
}

func looksLikeBackendName(value string) bool {
	for _, r := range value {
		if !(unicode.IsLower(r) || unicode.IsDigit(r) || r == '_' || r == '-') {
			return false
		}
	}
	return value != ""
}

func CreateRemote(ctx context.Context, name, providerType string, params map[string]string) error {
	if !validRemoteName(name) {
		return fmt.Errorf("invalid remote name %q", name)
	}
	if strings.TrimSpace(providerType) == "" {
		return fmt.Errorf("provider type is required")
	}
	if RemoteExists(name) {
		return fmt.Errorf("remote %q already exists", name)
	}

	args := []string{"config", "create", name, providerType, "--auto-confirm"}
	for k, v := range params {
		if strings.TrimSpace(k) == "" {
			continue
		}
		args = append(args, k, v)
	}
	env := oauthTemplateEnv(name)
	if _, err := runRcloneWithEnv(ctx, env, args...); err != nil {
		return fmt.Errorf("create remote: %w", err)
	}
	if err := EnsureRemoteDefaults(name); err != nil {
		return err
	}
	return nil
}

func RenameRemote(oldName, newName string) error {
	if oldName == newName {
		return nil
	}
	if !validRemoteName(oldName) || !validRemoteName(newName) {
		return fmt.Errorf("invalid remote name")
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
	if _, ok := remotes[newName]; ok {
		return fmt.Errorf("remote %q already exists", newName)
	}
	values, ok := remotes[oldName]
	if !ok {
		return fmt.Errorf("remote %q not found", oldName)
	}
	remotes[newName] = values
	delete(remotes, oldName)
	return writeConfigLocked(remotes)
}

func FinalizeRemoteName(ctx context.Context, tempName string) string {
	email, err := ResolveUserEmail(ctx, tempName)
	if err != nil {
		log.Printf("finalize remote %q: resolve email: %v", tempName, err)
		return tempName
	}
	if email == "" {
		return tempName
	}

	providerType := GetRemoteType(tempName)
	if providerType == "" {
		return tempName
	}

	newName := makeConfigName(email)
	if newName == tempName {
		return tempName
	}

	if RemoteExists(newName) {
		existingType := GetRemoteType(newName)
		switch {
		case existingType == providerType:
			DeleteRemote(newName)
		default:
			fallback := makeConfigName(providerType + "-" + email)
			if fallback == tempName {
				return tempName
			}
			if RemoteExists(fallback) {
				DeleteRemote(fallback)
			}
			if err := RenameRemote(tempName, fallback); err != nil {
				log.Printf("finalize remote %q: rename to %q: %v", tempName, fallback, err)
				return tempName
			}
			return fallback
		}
	}

	if err := RenameRemote(tempName, newName); err != nil {
		log.Printf("finalize remote %q: rename to %q: %v", tempName, newName, err)
		return tempName
	}
	if err := EnsureRemoteDefaults(newName); err != nil {
		log.Printf("finalize remote %q: ensure defaults on %q: %v", tempName, newName, err)
	}
	return newName
}

func DeleteRemote(name string) {
	if !validRemoteName(name) {
		return
	}
	configMu.Lock()
	defer configMu.Unlock()
	if err := ensureConfigFile(); err != nil {
		return
	}
	remotes, err := readConfigLocked()
	if err != nil {
		return
	}
	delete(remotes, name)
	_ = writeConfigLocked(remotes)
}

func GetRemoteType(name string) string {
	value, _ := getConfigValue(name, "type")
	return value
}

func RemoteExists(name string) bool {
	remotes, err := readConfig()
	if err != nil {
		return false
	}
	_, ok := remotes[name]
	return ok
}

func oauthTemplateEnv(name string) []string {
	tmpl := OAuthTemplatePath()
	if tmpl == "" || name == "" {
		return nil
	}
	return []string{configEnvKey(name, "config_template_file") + "=" + tmpl}
}

func configEnvKey(remote, key string) string {
	normalize := func(value string) string {
		var b strings.Builder
		for _, r := range strings.ToUpper(value) {
			if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
				b.WriteRune(r)
			} else {
				b.WriteRune('_')
			}
		}
		return b.String()
	}
	return "RCLONE_CONFIG_" + normalize(remote) + "_" + normalize(key)
}
