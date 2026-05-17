package rclone

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"
	"time"
)

type FileItem struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	IsDir    bool      `json:"is_dir"`
	Size     int64     `json:"size"`
	ModTime  time.Time `json:"mod_time"`
	MimeType string    `json:"mime_type,omitempty"`
	HashAlgo string    `json:"hash_algo,omitempty"`
	Hash     string    `json:"hash,omitempty"`
}

type rcloneListResponse struct {
	List []FileItem `json:"list"`
}

type rcloneStatResponse struct {
	Item *FileItem `json:"item"`
}

func ListDir(ctx context.Context, remoteName, dirPath string) ([]FileItem, error) {
	if err := startRcloneOperations(ctx); err != nil {
		return nil, err
	}

	var response rcloneListResponse
	if err := defaultRcloneRCD.Call(ctx, "operations/list", map[string]any{
		"fs":     remoteFS(remoteName),
		"remote": cleanRemotePath(dirPath),
	}, &response); err != nil {
		return nil, err
	}

	if response.List == nil {
		return []FileItem{}, nil
	}
	return response.List, nil
}

func ListDirStream(ctx context.Context, remoteName, dirPath string, emit func(FileItem) error) error {
	items, err := ListDir(ctx, remoteName, dirPath)
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := emit(item); err != nil {
			return err
		}
	}
	return nil
}

func DeletePath(ctx context.Context, remoteName, remotePath string) error {
	if err := startRcloneOperations(ctx); err != nil {
		return err
	}

	item, err := statPath(ctx, remoteName, remotePath)
	if err != nil {
		return err
	}
	if item == nil {
		return fmt.Errorf("remote path %q not found", remotePath)
	}

	method := "operations/deletefile"
	if item.IsDir {
		method = "operations/purge"
	}

	return defaultRcloneRCD.Call(ctx, method, map[string]any{
		"fs":     remoteFS(remoteName),
		"remote": cleanRemotePath(remotePath),
	}, nil)
}

func RenameFile(ctx context.Context, remoteName, oldPath, newPath string) error {
	if err := startRcloneOperations(ctx); err != nil {
		return err
	}

	return defaultRcloneRCD.Call(ctx, "operations/movefile", map[string]any{
		"srcFs":     remoteFS(remoteName),
		"srcRemote": cleanRemotePath(oldPath),
		"dstFs":     remoteFS(remoteName),
		"dstRemote": cleanRemotePath(newPath),
	}, nil)
}

func UploadFile(ctx context.Context, remoteName, dirPath, fileName string, _ int64, in io.Reader) error {
	if err := startRcloneOperations(ctx); err != nil {
		return err
	}

	return defaultRcloneRCD.UploadFile(
		ctx,
		remoteFS(remoteName),
		cleanRemotePath(dirPath),
		fileName,
		in,
	)
}

func DownloadFile(ctx context.Context, remoteName, remotePath string, out io.Writer) (int64, error) {
	if err := startRcloneOperations(ctx); err != nil {
		return 0, err
	}
	return defaultRcloneRCD.StreamCommand(ctx, out, "cat", remoteName+":"+remotePath)
}

func DownloadFileName(remotePath string) string {
	name := path.Base(remotePath)
	if name == "." || name == "/" || name == "" {
		return "download"
	}
	return name
}

func startRcloneOperations(ctx context.Context) error {
	if err := Init(); err != nil {
		return err
	}
	return defaultRcloneRCD.Start()
}

func statPath(ctx context.Context, remoteName, remotePath string) (*FileItem, error) {
	var response rcloneStatResponse
	if err := defaultRcloneRCD.Call(ctx, "operations/stat", map[string]any{
		"fs":     remoteFS(remoteName),
		"remote": cleanRemotePath(remotePath),
		"opt": map[string]any{
			"filesOnly": false,
		},
	}, &response); err != nil {
		return nil, err
	}
	return response.Item, nil
}

func remoteFS(remoteName string) string {
	return strings.TrimSpace(remoteName) + ":"
}

func cleanRemotePath(remotePath string) string {
	return strings.TrimPrefix(strings.TrimSpace(remotePath), "/")
}
