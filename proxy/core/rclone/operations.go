package rclone

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type lsjsonItem struct {
	Path     string            `json:"Path"`
	Name     string            `json:"Name"`
	Size     int64             `json:"Size"`
	MimeType string            `json:"MimeType"`
	ModTime  string            `json:"ModTime"`
	IsDir    bool              `json:"IsDir"`
	Hashes   map[string]string `json:"Hashes"`
}

func ListDir(ctx context.Context, remote, dirPath string) ([]FileItem, error) {
	out, err := runRclone(ctx, "lsjson", remoteSpec(remote, dirPath), "--hash")
	if err != nil {
		return nil, fmt.Errorf("list directory: %w", err)
	}

	var raw []lsjsonItem
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("parse lsjson: %w", err)
	}

	items := make([]FileItem, 0, len(raw))
	for _, entry := range raw {
		items = append(items, fileItemFromLsjson(dirPath, entry))
	}
	return items, nil
}

func DownloadFile(ctx context.Context, remote, filePath string, w io.Writer) (int64, error) {
	written, err := streamRclone(ctx, w, nil, "cat", remoteSpec(remote, filePath))
	if err != nil {
		return written, fmt.Errorf("download file: %w", err)
	}
	return written, nil
}

func UploadFile(ctx context.Context, remote, dirPath, fileName string, _ int64, reader io.Reader) error {
	if err := EnsureRemoteDefaults(remote); err != nil {
		return fmt.Errorf("apply remote defaults: %w", err)
	}
	target := remoteSpec(remote, path.Join(dirPath, fileName))
	if _, err := streamRclone(ctx, io.Discard, reader, "rcat", target); err != nil {
		return fmt.Errorf("upload file: %w", err)
	}
	return nil
}

func DownloadFolder(ctx context.Context, remote, remotePath, localPath string) error {
	if strings.TrimSpace(localPath) == "" {
		return fmt.Errorf("local path is required")
	}
	if err := os.MkdirAll(localPath, 0o700); err != nil {
		return fmt.Errorf("create local folder: %w", err)
	}
	if _, err := runRclone(ctx, "copy", remoteSpec(remote, remotePath), localPath, "--create-empty-src-dirs"); err != nil {
		return fmt.Errorf("download folder: %w", err)
	}
	return nil
}

func UploadFolder(ctx context.Context, remote, remotePath, localPath string) error {
	if err := EnsureRemoteDefaults(remote); err != nil {
		return fmt.Errorf("apply remote defaults: %w", err)
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("stat local folder: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("local path is not a folder")
	}
	if _, err := runRclone(ctx, "copy", localPath, remoteSpec(remote, remotePath), "--create-empty-src-dirs"); err != nil {
		return fmt.Errorf("upload folder: %w", err)
	}
	return nil
}

func TransferFolder(ctx context.Context, sourceRemote, sourcePath, destRemote, destPath string) error {
	stagingRoot, err := NewMistyTmpDir("folder-transfer-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stagingRoot)

	folderName := path.Base(path.Clean(sourcePath))
	if folderName == "." || folderName == "/" {
		folderName = "folder"
	}
	stagingFolder := filepath.Join(stagingRoot, folderName)

	if err := DownloadFolder(ctx, sourceRemote, sourcePath, stagingFolder); err != nil {
		return err
	}
	if err := UploadFolder(ctx, destRemote, destPath, stagingFolder); err != nil {
		return err
	}
	return nil
}

func MistyTmpRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", fmt.Errorf("resolve user home directory: %w", err)
	}
	root := filepath.Join(home, "misty", "tmp")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("create misty tmp: %w", err)
	}
	return root, nil
}

func NewMistyTmpDir(pattern string) (string, error) {
	root, err := MistyTmpRoot()
	if err != nil {
		return "", err
	}
	dir, err := os.MkdirTemp(root, pattern)
	if err != nil {
		return "", fmt.Errorf("create misty temp folder: %w", err)
	}
	return dir, nil
}

func IsMistyTmpPath(candidate string) (bool, error) {
	root, err := MistyTmpRoot()
	if err != nil {
		return false, err
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false, err
	}
	absCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return false, err
	}
	rel, err := filepath.Rel(absRoot, absCandidate)
	if err != nil {
		return false, err
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))), nil
}

func MkDir(ctx context.Context, remote, dirPath string) error {
	if _, err := runRclone(ctx, "mkdir", remoteSpec(remote, dirPath)); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	return nil
}

func DeletePath(ctx context.Context, remote, filePath string) error {
	if _, err := runRclone(ctx, "deletefile", remoteSpec(remote, filePath)); err == nil {
		return nil
	}
	if _, err := runRclone(ctx, "purge", remoteSpec(remote, filePath)); err != nil {
		return fmt.Errorf("delete path: %w", err)
	}
	return nil
}

func About(ctx context.Context, remote string) (*AboutInfo, error) {
	out, err := runRclone(ctx, "about", remoteSpec(remote, ""), "--json")
	if err != nil {
		return nil, fmt.Errorf("about: %w", err)
	}
	var raw struct {
		Total   int64 `json:"total"`
		Used    int64 `json:"used"`
		Free    int64 `json:"free"`
		Trashed int64 `json:"trashed"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("parse about: %w", err)
	}
	return &AboutInfo{
		Remote:  remote,
		Total:   raw.Total,
		Used:    raw.Used,
		Free:    raw.Free,
		Trashed: raw.Trashed,
	}, nil
}

func Search(ctx context.Context, remote, basePath, query string, maxResults int) ([]FileItem, error) {
	if maxResults <= 0 {
		maxResults = 50
	}

	out, err := runRclone(ctx, "lsjson", remoteSpec(remote, basePath), "--recursive", "--hash")
	if err != nil {
		return nil, fmt.Errorf("search list: %w", err)
	}

	var raw []lsjsonItem
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("parse search lsjson: %w", err)
	}

	query = strings.ToLower(query)
	results := make([]FileItem, 0, min(maxResults, len(raw)))
	for _, entry := range raw {
		name := entry.Name
		if name == "" {
			name = path.Base(entry.Path)
		}
		if !strings.Contains(strings.ToLower(name), query) &&
			!strings.Contains(strings.ToLower(entry.Path), query) {
			continue
		}
		results = append(results, fileItemFromLsjson(basePath, entry))
		if len(results) >= maxResults {
			break
		}
	}
	return results, nil
}

func remoteSpec(remote, remotePath string) string {
	if remotePath == "." {
		remotePath = ""
	}
	return remote + ":" + remotePath
}

func fileItemFromLsjson(basePath string, entry lsjsonItem) FileItem {
	name := entry.Name
	if name == "" {
		name = path.Base(entry.Path)
	}
	itemPath := entry.Path
	if itemPath == "" {
		itemPath = name
	}
	if basePath != "" {
		itemPath = path.Join(basePath, itemPath)
	}

	hashAlgo, hashValue := preferredRemoteHash(entry.Hashes)
	return FileItem{
		Name:     name,
		Path:     itemPath,
		IsDir:    entry.IsDir,
		Size:     entry.Size,
		ModTime:  parseRcloneTime(entry.ModTime),
		MimeType: entry.MimeType,
		HashAlgo: hashAlgo,
		Hash:     hashValue,
	}
}

func preferredRemoteHash(hashes map[string]string) (string, string) {
	if len(hashes) == 0 {
		return "", ""
	}
	for _, key := range []string{"CRC-32", "CRC32", "MD5", "SHA-1", "SHA1"} {
		if value := strings.TrimSpace(hashes[key]); value != "" {
			return normalizeHashAlgorithm(key), strings.ToLower(value)
		}
	}
	keys := make([]string, 0, len(hashes))
	for key := range hashes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if value := strings.TrimSpace(hashes[key]); value != "" {
			return normalizeHashAlgorithm(key), strings.ToLower(value)
		}
	}
	return "", ""
}

func normalizeHashAlgorithm(value string) string {
	switch strings.ToUpper(strings.ReplaceAll(value, "-", "")) {
	case "CRC32":
		return "CRC-32"
	case "SHA1":
		return "SHA-1"
	case "MD5":
		return "MD5"
	default:
		return value
	}
}

func parseRcloneTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed
		}
	}
	return time.Time{}
}
