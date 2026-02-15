package syncindex

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"time"

	dbpkg "github.com/kannachi323/misty/proxy/db"
	"github.com/kannachi323/misty/proxy/core/rclone"
)

type Service struct {
	database *dbpkg.Database
}

func NewService(database *dbpkg.Database) *Service {
	return &Service{database: database}
}

func (s *Service) RefetchDirectory(ctx context.Context, remoteName, dirPath string) (*DirectoryResponse, error) {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return nil, fmt.Errorf("sync index database unavailable")
	}
	if remoteName == "" {
		return nil, fmt.Errorf("remote is required")
	}
	if !rclone.RemoteExists(remoteName) {
		return nil, fmt.Errorf("remote not found")
	}

	root, err := s.ensureRoot(remoteName)
	if err != nil {
		return nil, err
	}

	remoteItems, err := rclone.ListDir(ctx, remoteName, dirPath)
	if err != nil {
		return nil, err
	}

	localItems, err := scanLocalDirectory(buildLocalPath(*root, dirPath))
	if err != nil {
		return nil, err
	}

	now := dbpkg.NowRFC3339()
	merged := mergeDirectoryItems(root.ID, dirPath, remoteItems, localItems, now)

	tx, err := s.database.Conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	root.LastRefetchAt = now
	root.UpdatedAt = now
	if err = dbpkg.UpsertSyncRoot(tx, *root); err != nil {
		return nil, err
	}

	existingPaths, err := dbpkg.ListSyncEntryPathsByParent(s.database.Conn, root.ID, dirPath)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(merged))
	for _, item := range merged {
		seen[item.entry.RelPath] = struct{}{}
		if err = dbpkg.UpsertSyncEntry(tx, item.entry); err != nil {
			return nil, err
		}
	}
	for _, existingPath := range existingPaths {
		if _, ok := seen[existingPath]; ok {
			continue
		}
		if err = dbpkg.DeleteSyncEntriesByPathPrefix(tx, root.ID, existingPath); err != nil {
			return nil, err
		}
	}

	if err = tx.Commit(); err != nil {
		return nil, err
	}

	dirtyBit, err := dbpkg.RootHasDirtyEntries(s.database.Conn, root.ID)
	if err != nil {
		return nil, err
	}
	if err = dbpkg.SetSyncRootDirtyBit(s.database.Conn, root.ID, dirtyBit, now); err != nil {
		return nil, err
	}
	root.DirtyBit = dirtyBit

	return s.ListDirectory(ctx, remoteName, dirPath)
}

// MarkLocalDirty records a local filesystem change against the sync index so
// the reconciler can pick it up without waiting for the next full refetch.
// This is the entry point for the client's FSEvents watcher and for explicit
// user actions like "New File" or "Delete local".
//
// If the entry already exists, only local-side columns are touched — we never
// clobber RemoteMTime/RemoteSize gathered from a prior rclone listing. If it
// doesn't, a new row is written with RemoteExists=false, which reconcileState
// then classifies as LOC (push-only, dirty).
func (s *Service) MarkLocalDirty(ctx context.Context, remoteName, relPath string, localExists, isDir bool, mtime string, size int64) error {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return fmt.Errorf("sync index database unavailable")
	}
	if remoteName == "" {
		return fmt.Errorf("remote is required")
	}
	if relPath == "" {
		return fmt.Errorf("path is required")
	}
	if !rclone.RemoteExists(remoteName) {
		return fmt.Errorf("remote not found")
	}

	root, err := s.ensureRoot(remoteName)
	if err != nil {
		return err
	}

	now := dbpkg.NowRFC3339()
	if mtime == "" {
		mtime = now
	}

	entryID := dbpkg.MakeSyncEntryID(root.ID, relPath)
	existing, err := dbpkg.GetSyncEntry(s.database.Conn, entryID)
	if err != nil {
		return err
	}

	entry := dbpkg.SyncEntry{
		ID:            entryID,
		RootID:        root.ID,
		RelPath:       relPath,
		ParentRelPath: path.Dir(relPath),
		Name:          path.Base(relPath),
		IsDir:         isDir,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if entry.ParentRelPath == "." {
		entry.ParentRelPath = ""
	}
	if existing != nil {
		// Keep remote-side fields intact; only local columns move.
		entry.CreatedAt = existing.CreatedAt
		entry.RemoteExists = existing.RemoteExists
		entry.RemoteMTime = existing.RemoteMTime
		entry.RemoteSize = existing.RemoteSize
		entry.RemoteRevision = existing.RemoteRevision
		entry.MimeType = existing.MimeType
		entry.LastSeenRemote = existing.LastSeenRemote
		entry.IsDir = existing.IsDir || isDir
	}
	entry.LocalExists = localExists
	if localExists {
		entry.LocalMTime = mtime
		entry.LocalSize = sql.NullInt64{Int64: size, Valid: !entry.IsDir}
		entry.LastSeenLocal = now
	} else {
		entry.LocalMTime = ""
		entry.LocalSize = sql.NullInt64{}
		entry.LastSeenLocal = now
	}
	entry.StateCode, entry.IsDirty, entry.SyncDirection = reconcileState(entry)

	tx, err := s.database.Conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	root.UpdatedAt = now
	if err = dbpkg.UpsertSyncRoot(tx, *root); err != nil {
		return err
	}
	if err = dbpkg.UpsertSyncEntry(tx, entry); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}

	if entry.IsDirty {
		if err = dbpkg.SetSyncRootDirtyBit(s.database.Conn, root.ID, true, ""); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ListDirectory(_ context.Context, remoteName, dirPath string) (*DirectoryResponse, error) {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return nil, fmt.Errorf("sync index database unavailable")
	}
	if remoteName == "" {
		return nil, fmt.Errorf("remote is required")
	}

	root, err := dbpkg.GetSyncRootByRemoteName(s.database.Conn, remoteName)
	if err != nil {
		return nil, err
	}
	if root == nil {
		return &DirectoryResponse{Remote: remoteName, Path: dirPath, Items: []DirectoryItem{}}, nil
	}

	entries, err := dbpkg.ListSyncEntriesByParent(s.database.Conn, root.ID, dirPath)
	if err != nil {
		return nil, err
	}

	items := make([]DirectoryItem, 0, len(entries))
	for _, entry := range entries {
		localPath := buildLocalPath(*root, entry.RelPath)
		size, modTime := entry.RemoteSize.Int64, entry.RemoteMTime
		if entry.LocalExists {
			if entry.LocalSize.Valid {
				size = entry.LocalSize.Int64
			}
			if entry.LocalMTime != "" {
				modTime = entry.LocalMTime
			}
		}
		items = append(items, DirectoryItem{
			Name:          entry.Name,
			Path:          entry.RelPath,
			LocalPath:     localPath,
			IsDir:         entry.IsDir,
			Size:          size,
			ModTime:       modTime,
			MimeType:      entry.MimeType,
			State:         entry.StateCode,
			SyncDirty:     entry.IsDirty,
			SyncDirection: entry.SyncDirection,
		})
	}

	return &DirectoryResponse{
		Items:    items,
		Remote:   remoteName,
		Path:     dirPath,
		DirtyBit: root.DirtyBit,
	}, nil
}

func (s *Service) ensureRoot(remoteName string) (*dbpkg.SyncRoot, error) {
	root, err := dbpkg.GetSyncRootByRemoteName(s.database.Conn, remoteName)
	if err != nil {
		return nil, err
	}

	remoteType := rclone.GetRemoteType(remoteName)
	providerFolder, folderName, mountRoot := resolveMountMapping(remoteName, remoteType)
	now := dbpkg.NowRFC3339()

	if root == nil {
		root = &dbpkg.SyncRoot{
			ID:             dbpkg.MakeSyncRootID(remoteName),
			RemoteName:     remoteName,
			RemoteType:     remoteType,
			ProviderFolder: providerFolder,
			FolderName:     folderName,
			MountRoot:      mountRoot,
			Enabled:        true,
			DirtyBit:       false,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
	} else {
		root.RemoteType = remoteType
		root.ProviderFolder = providerFolder
		root.FolderName = folderName
		root.MountRoot = mountRoot
		root.Enabled = true
		root.UpdatedAt = now
		if root.CreatedAt == "" {
			root.CreatedAt = now
		}
	}

	return root, nil
}

type localDirItem struct {
	name    string
	relPath string
	isDir   bool
	size    int64
	modTime string
}

type mergedDirItem struct {
	entry dbpkg.SyncEntry
}

func scanLocalDirectory(dir string) (map[string]localDirItem, error) {
	items := make(map[string]localDirItem)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return items, nil
		}
		return nil, err
	}

	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items[entry.Name()] = localDirItem{
			name:    entry.Name(),
			isDir:   entry.IsDir(),
			size:    info.Size(),
			modTime: info.ModTime().UTC().Format(time.RFC3339Nano),
		}
	}
	return items, nil
}

func mergeDirectoryItems(rootID, parentRelPath string, remoteItems []rclone.FileItem, localItems map[string]localDirItem, now string) []mergedDirItem {
	remoteByName := make(map[string]rclone.FileItem, len(remoteItems))
	for _, item := range remoteItems {
		remoteByName[item.Name] = item
	}

	names := make(map[string]struct{}, len(remoteByName)+len(localItems))
	for name := range remoteByName {
		names[name] = struct{}{}
	}
	for name := range localItems {
		names[name] = struct{}{}
	}

	items := make([]mergedDirItem, 0, len(names))
	for name := range names {
		remoteItem, hasRemote := remoteByName[name]
		localItem, hasLocal := localItems[name]

		relPath := remoteItem.Path
		if relPath == "" {
			relPath = joinRemotePath(parentRelPath, name)
		}

		entry := dbpkg.SyncEntry{
			ID:            dbpkg.MakeSyncEntryID(rootID, relPath),
			RootID:        rootID,
			RelPath:       relPath,
			ParentRelPath: parentRelPath,
			Name:          name,
			CreatedAt:     now,
			UpdatedAt:     now,
		}

		if hasRemote {
			entry.IsDir = remoteItem.IsDir
			entry.RemoteExists = true
			entry.RemoteMTime = remoteItem.ModTime.UTC().Format(time.RFC3339Nano)
			entry.RemoteSize = sql.NullInt64{Int64: remoteItem.Size, Valid: !remoteItem.IsDir}
			entry.MimeType = remoteItem.MimeType
			entry.LastSeenRemote = now
		}
		if hasLocal {
			entry.IsDir = localItem.isDir
			entry.LocalExists = true
			entry.LocalMTime = localItem.modTime
			entry.LocalSize = sql.NullInt64{Int64: localItem.size, Valid: !localItem.isDir}
			entry.LastSeenLocal = now
		}

		entry.StateCode, entry.IsDirty, entry.SyncDirection = reconcileState(entry)
		items = append(items, mergedDirItem{entry: entry})
	}

	return items
}

func reconcileState(entry dbpkg.SyncEntry) (state string, dirty bool, direction string) {
	switch {
	case entry.LocalExists && !entry.RemoteExists:
		return "LOC", true, "push"
	case entry.RemoteExists && !entry.LocalExists:
		return "REM", false, "none"
	case !entry.LocalExists && !entry.RemoteExists:
		return "REM", false, "none"
	}

	if metadataMatches(entry) {
		return "LOC", false, "none"
	}

	direction = "conflict"
	localTime, localOK := parseTime(entry.LocalMTime)
	remoteTime, remoteOK := parseTime(entry.RemoteMTime)
	switch {
	case localOK && remoteOK && localTime.After(remoteTime):
		direction = "push"
	case localOK && remoteOK && remoteTime.After(localTime):
		direction = "pull"
	case localOK && !remoteOK:
		direction = "push"
	case !localOK && remoteOK:
		direction = "pull"
	}
	return "MOD", true, direction
}

func metadataMatches(entry dbpkg.SyncEntry) bool {
	if entry.IsDir {
		return true
	}
	if !entry.LocalSize.Valid || !entry.RemoteSize.Valid {
		return false
	}
	if entry.LocalSize.Int64 != entry.RemoteSize.Int64 {
		return false
	}

	localTime, localOK := parseTime(entry.LocalMTime)
	remoteTime, remoteOK := parseTime(entry.RemoteMTime)
	if !localOK || !remoteOK {
		return false
	}
	diff := localTime.Sub(remoteTime)
	if diff < 0 {
		diff = -diff
	}
	return diff <= 2*time.Second
}

func parseTime(value string) (time.Time, bool) {
	if value == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func buildLocalPath(root dbpkg.SyncRoot, relPath string) string {
	pathParts := []string{root.MountRoot}
	if root.ProviderFolder != "" {
		pathParts = append(pathParts, root.ProviderFolder)
	}
	if root.FolderName != "" {
		pathParts = append(pathParts, root.FolderName)
	}
	if relPath != "" {
		pathParts = append(pathParts, filepath.FromSlash(relPath))
	}
	return filepath.Join(pathParts...)
}

func joinRemotePath(parentRelPath, name string) string {
	if parentRelPath == "" {
		return name
	}
	return path.Join(parentRelPath, name)
}
