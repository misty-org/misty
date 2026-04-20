package rclone

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"
	rclonehash "github.com/rclone/rclone/fs/hash"
	"github.com/rclone/rclone/fs/object"
	"github.com/rclone/rclone/fs/operations"
	"github.com/rclone/rclone/fs/walk"
)

// ListDir lists the contents of a directory on a remote.
func ListDir(ctx context.Context, remote, dirPath string) ([]FileItem, error) {
	Init()
	f, err := fs.NewFs(ctx, remote+":"+dirPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create fs: %w", err)
	}

	entries, err := f.List(ctx, "")
	if err != nil {
		return nil, fmt.Errorf("failed to list directory: %w", err)
	}

	items := make([]FileItem, 0, len(entries))
	supportedHashes := f.Hashes()
	hashType := rclonehash.None
	if supportedHashes.Count() > 0 {
		hashType = supportedHashes.GetOne()
	}
	for _, entry := range entries {
		item := FileItem{
			Name:    entry.Remote(),
			Path:    path.Join(dirPath, entry.Remote()),
			ModTime: entry.ModTime(ctx),
		}
		switch e := entry.(type) {
		case fs.Directory:
			item.IsDir = true
			item.Size = e.Size()
		case fs.Object:
			item.IsDir = false
			item.Size = e.Size()
			item.MimeType = fs.MimeType(ctx, e)
			if hashType != rclonehash.None {
				if hashValue, err := e.Hash(ctx, hashType); err == nil && hashValue != "" {
					item.HashAlgo = hashType.String()
					item.Hash = hashValue
				}
			}
		}
		items = append(items, item)
	}
	return items, nil
}

// DownloadFile streams a file from a remote to the provided writer.
func DownloadFile(ctx context.Context, remote, filePath string, w io.Writer) (int64, error) {
	Init()

	dir := path.Dir(filePath)
	// path.Dir returns "." for a bare filename (file at root). rclone treats
	// "remote:." as a different filesystem than "remote:" — the former misses
	// the actual root and NewObject returns "object not found". Normalize.
	if dir == "." {
		dir = ""
	}
	name := path.Base(filePath)

	f, err := fs.NewFs(ctx, remote+":"+dir)
	if err != nil {
		return 0, fmt.Errorf("failed to create fs: %w", err)
	}

	obj, err := f.NewObject(ctx, name)
	if err != nil {
		return 0, fmt.Errorf("file not found: %w", err)
	}

	reader, err := obj.Open(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to open file: %w", err)
	}
	defer reader.Close()

	written, err := io.Copy(w, reader)
	return written, err
}

// UploadFile uploads a file from the provided reader to a remote directory.
func UploadFile(ctx context.Context, remote, dirPath, fileName string, size int64, reader io.Reader) error {
	Init()
	if err := EnsureRemoteDefaults(remote); err != nil {
		return fmt.Errorf("failed to apply remote defaults: %w", err)
	}
	f, err := fs.NewFs(ctx, remote+":"+dirPath)
	if err != nil {
		return fmt.Errorf("failed to create fs: %w", err)
	}

	info := object.NewStaticObjectInfo(fileName, time.Now(), size, true, nil, nil)
	_, err = f.Put(ctx, reader, info)
	if err != nil {
		return fmt.Errorf("failed to upload file: %w", err)
	}
	return nil
}

// MkDir creates a directory on a remote.
func MkDir(ctx context.Context, remote, dirPath string) error {
	Init()
	f, err := fs.NewFs(ctx, remote+":"+dirPath)
	if err != nil {
		return fmt.Errorf("failed to create fs: %w", err)
	}
	return operations.Mkdir(ctx, f, "")
}

// DeletePath deletes a file or directory on a remote.
func DeletePath(ctx context.Context, remote, filePath string) error {
	Init()

	dir := path.Dir(filePath)
	// See note in DownloadFile: rclone treats "remote:." differently from
	// "remote:". Normalize the bare-filename case so root files are deletable.
	if dir == "." {
		dir = ""
	}
	name := path.Base(filePath)

	f, err := fs.NewFs(ctx, remote+":"+dir)
	if err != nil {
		return fmt.Errorf("failed to create fs: %w", err)
	}

	// Try as file first
	obj, err := f.NewObject(ctx, name)
	if err == nil {
		return operations.DeleteFile(ctx, obj)
	}

	// If not a file, try as directory
	dirFs, err := fs.NewFs(ctx, remote+":"+filePath)
	if err != nil {
		return fmt.Errorf("path not found: %w", err)
	}
	return operations.Purge(ctx, dirFs, "")
}

// About returns storage quota information for a remote.
func About(ctx context.Context, remote string) (*AboutInfo, error) {
	Init()
	f, err := fs.NewFs(ctx, remote+":")
	if err != nil {
		return nil, fmt.Errorf("failed to create fs: %w", err)
	}

	aboutFunc := f.Features().About
	if aboutFunc == nil {
		return nil, fmt.Errorf("remote %q does not support storage info", remote)
	}

	usage, err := aboutFunc(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get storage info: %w", err)
	}

	info := &AboutInfo{Remote: remote}
	if usage.Total != nil {
		info.Total = *usage.Total
	}
	if usage.Used != nil {
		info.Used = *usage.Used
	}
	if usage.Free != nil {
		info.Free = *usage.Free
	}
	if usage.Trashed != nil {
		info.Trashed = *usage.Trashed
	}
	return info, nil
}

// Search walks a remote directory tree and returns files matching the query string.
// Results are capped at maxResults.
func Search(ctx context.Context, remote, basePath, query string, maxResults int) ([]FileItem, error) {
	Init()
	if maxResults <= 0 {
		maxResults = 50
	}

	f, err := fs.NewFs(ctx, remote+":"+basePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create fs: %w", err)
	}

	query = strings.ToLower(query)
	var results []FileItem

	err = walk.ListR(ctx, f, "", true, -1, walk.ListAll, func(entries fs.DirEntries) error {
		for _, entry := range entries {
			if len(results) >= maxResults {
				return io.EOF // stop walking
			}
			if strings.Contains(strings.ToLower(entry.Remote()), query) {
				item := FileItem{
					Name:    path.Base(entry.Remote()),
					Path:    path.Join(basePath, entry.Remote()),
					ModTime: entry.ModTime(ctx),
				}
				switch e := entry.(type) {
				case fs.Directory:
					item.IsDir = true
				case fs.Object:
					item.Size = e.Size()
					item.MimeType = fs.MimeType(ctx, e)
				}
				results = append(results, item)
			}
		}
		return nil
	})

	// io.EOF is our intentional stop signal, not an error
	if err == io.EOF {
		err = nil
	}

	return results, err
}
