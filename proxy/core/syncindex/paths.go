package syncindex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type remoteAliasFile struct {
	Remotes map[string]struct {
		Alias          string `json:"alias"`
		ProviderFolder string `json:"provider_folder"`
		FolderName     string `json:"folder_name"`
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
	return filepath.Join(home, "misty", "rclone", "remotes.json")
}

type remoteMetadata struct {
	Alias          string
	ProviderFolder string
	FolderName     string
}

func loadRemoteMetadata(remoteName string) remoteMetadata {
	path := remotesMetadataPath()
	body, err := os.ReadFile(path)
	if err != nil {
		return remoteMetadata{}
	}

	var metadata remoteAliasFile
	if err := json.Unmarshal(body, &metadata); err != nil {
		return remoteMetadata{}
	}
	if metadata.Remotes == nil {
		return remoteMetadata{}
	}
	entry, ok := metadata.Remotes[remoteName]
	if !ok {
		return remoteMetadata{}
	}
	return remoteMetadata{
		Alias:          strings.TrimSpace(entry.Alias),
		ProviderFolder: strings.TrimSpace(entry.ProviderFolder),
		FolderName:     strings.TrimSpace(entry.FolderName),
	}
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
	metadata := loadRemoteMetadata(remoteName)
	providerFolder = metadata.ProviderFolder
	if providerFolder == "" {
		providerFolder = displayNameForType(remoteType)
	}
	folderName = metadata.FolderName
	if folderName == "" {
		folderName = sanitizeFolderName(metadata.Alias, remoteName)
	}
	root = mountRoot()
	return providerFolder, folderName, root
}
