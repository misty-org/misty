package syncindex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type remoteAliasFile struct {
	Remotes map[string]struct {
		Alias string `json:"alias"`
	} `json:"remotes"`
}

func mountRoot() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	return filepath.Join(home, "misty", "mnt")
}

func remotesMetadataPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	return filepath.Join(home, "misty", "remotes.json")
}

func loadRemoteAlias(remoteName string) string {
	path := remotesMetadataPath()
	body, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	var metadata remoteAliasFile
	if err := json.Unmarshal(body, &metadata); err != nil {
		return ""
	}
	if metadata.Remotes == nil {
		return ""
	}
	entry, ok := metadata.Remotes[remoteName]
	if !ok {
		return ""
	}
	return strings.TrimSpace(entry.Alias)
}

func displayNameForType(remoteType string) string {
	switch remoteType {
	case "onedrive":
		return "OneDrive"
	case "drive":
		return "Google Drive"
	case "dropbox":
		return "Dropbox"
	case "s3":
		return "Amazon S3"
	case "sftp":
		return "SFTP"
	default:
		if remoteType == "" {
			return ""
		}
		runes := []rune(remoteType)
		if len(runes) == 0 {
			return remoteType
		}
		runes[0] = []rune(strings.ToUpper(string(runes[0])))[0]
		return string(runes)
	}
}

func sanitizeFolderName(preferred, fallback string) string {
	name := strings.TrimSpace(preferred)
	if name == "" {
		name = fallback
	}

	replacer := strings.NewReplacer(
		"<", "-",
		">", "-",
		":", "-",
		"\"", "-",
		"/", "-",
		"\\", "-",
		"|", "-",
		"?", "-",
		"*", "-",
	)
	name = strings.TrimSpace(replacer.Replace(name))
	if name == "" {
		return fallback
	}
	return name
}

func resolveMountMapping(remoteName, remoteType string) (providerFolder string, folderName string, root string) {
	alias := loadRemoteAlias(remoteName)
	providerFolder = displayNameForType(remoteType)
	folderName = sanitizeFolderName(alias, remoteName)
	root = mountRoot()
	return providerFolder, folderName, root
}
