package syncindex

import (
	"context"
	"crypto/md5"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"fmt"
	"hash"
	"hash/crc32"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/kannachi323/misty/proxy/core/rclone"
	dbpkg "github.com/kannachi323/misty/proxy/db"
)

type Service struct {
	database *dbpkg.Database
}

func NewService(database *dbpkg.Database) *Service {
	return &Service{database: database}
}

func (s *Service) ensureSyncRoot(remoteName string) (*dbpkg.SyncRoot, error) {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return nil, fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return nil, fmt.Errorf("remote is required")
	}

	root, err := dbpkg.GetSyncRootByRemoteName(s.database.Conn, remoteName)
	if err != nil {
		return nil, err
	}

	now := dbpkg.NowRFC3339()
	if root == nil {
		providerFolder, folderName, mountRootPath := resolveMountMapping(remoteName, "")
		root = &dbpkg.SyncRoot{
			ID:             dbpkg.MakeSyncRootID(remoteName),
			RemoteName:     remoteName,
			ProviderFolder: providerFolder,
			FolderName:     folderName,
			MountRoot:      mountRootPath,
			Enabled:        true,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
	} else {
		root.Enabled = true
		root.UpdatedAt = now
		if root.CreatedAt == "" {
			root.CreatedAt = now
		}
	}

	if err := dbpkg.UpsertSyncRoot(s.database.Conn, *root); err != nil {
		return nil, err
	}
	return root, nil
}

func (s *Service) upsertSyncEntryForRow(root *dbpkg.SyncRoot, row dbpkg.FileMetadata) error {
	if root == nil {
		return fmt.Errorf("sync root is required")
	}

	stateCode, dirty, direction := deriveDirectoryItemState(row)
	now := row.UpdatedAt
	if now == "" {
		now = dbpkg.NowRFC3339()
	}
	entry := dbpkg.SyncEntry{
		ID:             dbpkg.MakeSyncEntryID(root.ID, row.RelPath),
		RootID:         root.ID,
		RelPath:        row.RelPath,
		ParentRelPath:  row.ParentRelPath,
		Name:           row.Name,
		IsDir:          row.IsDir,
		LocalExists:    row.LocalExists,
		RemoteExists:   row.RemoteExists,
		IsDirty:        dirty,
		SyncDirection:  direction,
		LocalMTime:     row.LocalMTime,
		LocalSize:      row.LocalSize,
		RemoteMTime:    row.RemoteMTime,
		RemoteSize:     row.RemoteSize,
		RemoteRevision: row.RemoteRevision,
		MimeType:       row.MimeType,
		StateCode:      stateCode,
		LastSeenLocal:  row.LastLocalSeen,
		LastSeenRemote: row.LastRemoteSeen,
		LastError:      row.LastError,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	return dbpkg.UpsertSyncEntry(s.database.Conn, entry)
}

func (s *Service) refreshSyncRootDirtyBit(rootID, remoteName string) error {
	stillDirty, err := dbpkg.RemoteHasDirtyEntries(s.database.Conn, remoteName)
	if err != nil {
		return err
	}
	return dbpkg.SetSyncRootDirtyBit(s.database.Conn, rootID, stillDirty, "")
}

func isMissingDirectoryError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "directory not found")
}

func (s *Service) pruneMissingRemoteDirectory(root *dbpkg.SyncRoot, remoteName, dirPath string) error {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return fmt.Errorf("sync metadata database unavailable")
	}
	if root == nil {
		return fmt.Errorf("sync root is required")
	}
	if err := dbpkg.DeleteSyncEntriesByPathPrefix(s.database.Conn, root.ID, dirPath); err != nil {
		return err
	}
	if err := dbpkg.DeleteFileMetadataByPathPrefix(s.database.Conn, remoteName, dirPath); err != nil {
		return err
	}
	return s.refreshSyncRootDirtyBit(root.ID, remoteName)
}

func (s *Service) emptyDirectoryResponse(remoteName, dirPath string) (*DirectoryResponse, error) {
	dirtyBit, err := dbpkg.RemoteHasDirtyEntries(s.database.Conn, remoteName)
	if err != nil {
		return nil, err
	}
	watched, err := dbpkg.IsWatchedDir(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return nil, err
	}
	return &DirectoryResponse{
		Items:    []DirectoryItem{},
		Remote:   remoteName,
		Path:     dirPath,
		DirtyBit: dirtyBit,
		Watched:  watched,
	}, nil
}

func (s *Service) BackfillQueueForRemote(remoteName string) error {
	root, err := s.ensureSyncRoot(remoteName)
	if err != nil {
		return err
	}

	rows, err := dbpkg.ListFileMetadataByRemote(s.database.Conn, remoteName)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := s.upsertSyncEntryForRow(root, row); err != nil {
			return err
		}
	}
	return s.refreshSyncRootDirtyBit(root.ID, remoteName)
}

func (s *Service) RefetchDirectory(ctx context.Context, remoteName, dirPath string) (*DirectoryResponse, error) {
	return s.refreshDirectory(ctx, remoteName, dirPath, false)
}

func directoryItemForRow(remoteName string, row dbpkg.FileMetadata) DirectoryItem {
	state, dirty, direction := deriveDirectoryItemState(row)
	reason := deriveDirectoryItemReason(row)
	localPath := buildLocalPath(remoteName, row.RelPath)
	size, modTime := row.RemoteSize.Int64, row.RemoteMTime
	if row.LocalExists {
		if row.LocalSize.Valid {
			size = row.LocalSize.Int64
		}
		if row.LocalMTime != "" {
			modTime = row.LocalMTime
		}
	}
	return DirectoryItem{
		Name:          row.Name,
		Path:          row.RelPath,
		LocalPath:     localPath,
		IsDir:         row.IsDir,
		Size:          size,
		ModTime:       modTime,
		MimeType:      row.MimeType,
		State:         state,
		SyncDirty:     dirty,
		SyncDirection: direction,
		DirtyReason:   reason,
	}
}

func (s *Service) directoryResponseFromRows(remoteName, dirPath string, rows []dbpkg.FileMetadata) (*DirectoryResponse, error) {
	items := make([]DirectoryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, directoryItemForRow(remoteName, row))
	}

	dirtyBit, err := dbpkg.RemoteHasDirtyEntries(s.database.Conn, remoteName)
	if err != nil {
		return nil, err
	}
	watched, err := dbpkg.IsWatchedDir(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return nil, err
	}

	return &DirectoryResponse{
		Items:    items,
		Remote:   remoteName,
		Path:     dirPath,
		DirtyBit: dirtyBit,
		Watched:  watched,
	}, nil
}

func (s *Service) streamDirectoryRows(remoteName, dirPath string, rows []dbpkg.FileMetadata,
	emit func(DirectoryStreamChunk) error) error {
	dirtyBit, err := dbpkg.RemoteHasDirtyEntries(s.database.Conn, remoteName)
	if err != nil {
		return err
	}
	watched, err := dbpkg.IsWatchedDir(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return err
	}

	const batchSize = 128
	batch := make([]DirectoryItem, 0, batchSize)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		items := append([]DirectoryItem(nil), batch...)
		batch = batch[:0]
		return emit(DirectoryStreamChunk{
			Type:   "items",
			Remote: remoteName,
			Path:   dirPath,
			Items:  items,
		})
	}

	for _, row := range rows {
		batch = append(batch, directoryItemForRow(remoteName, row))
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := flush(); err != nil {
		return err
	}
	return emit(DirectoryStreamChunk{
		Type:     "done",
		Remote:   remoteName,
		Path:     dirPath,
		DirtyBit: dirtyBit,
		Watched:  watched,
	})
}

func (s *Service) StreamDirectory(ctx context.Context, remoteName, dirPath string,
	emit func(DirectoryStreamChunk) error) error {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return fmt.Errorf("remote is required")
	}

	rows, err := dbpkg.ListFileMetadataByParent(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return err
	}
	if len(rows) > 0 {
		return s.streamDirectoryRows(remoteName, dirPath, rows, emit)
	}
	return s.refreshDirectoryStream(ctx, remoteName, dirPath, false, emit)
}

func (s *Service) ListDirectory(ctx context.Context, remoteName, dirPath string) (*DirectoryResponse, error) {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return nil, fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return nil, fmt.Errorf("remote is required")
	}

	rows, err := dbpkg.ListFileMetadataByParent(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return s.refreshDirectory(ctx, remoteName, dirPath, false)
	}
	return s.directoryResponseFromRows(remoteName, dirPath, rows)
}

func (s *Service) MarkLocalDirty(_ context.Context, remoteName, relPath string, localExists, isDir bool, mtime string, size int64) error {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return fmt.Errorf("remote is required")
	}
	if relPath == "" {
		return fmt.Errorf("path is required")
	}

	now := dbpkg.NowRFC3339()
	row, err := dbpkg.GetFileMetadata(s.database.Conn, remoteName, relPath)
	if err != nil {
		return err
	}
	if row == nil {
		row = &dbpkg.FileMetadata{
			RemoteName:    remoteName,
			RelPath:       relPath,
			ParentRelPath: parentPath(relPath),
			Name:          path.Base(relPath),
		}
	}
	prev := *row

	row.IsDir = row.IsDir || isDir
	row.ParentRelPath = parentPath(relPath)
	row.Name = path.Base(relPath)
	row.LocalExists = localExists
	row.LastComparedAt = now
	row.UpdatedAt = now
	row.LastError = ""
	if localExists {
		if mtime == "" {
			mtime = now
		}
		row.LocalMTime = mtime
		row.LocalSize = sql.NullInt64{Int64: size, Valid: !row.IsDir}
		row.LastLocalSeen = now
	} else {
		row.LocalMTime = ""
		row.LocalSize = sql.NullInt64{}
		row.LastLocalSeen = now
	}
	if row.LocalDirty || localObservationChanged(prev, *row) {
		row.LocalDirty = true
		row.LastLocalEvent = now
	}
	if err := dbpkg.UpsertFileMetadata(s.database.Conn, *row); err != nil {
		return err
	}
	root, err := s.ensureSyncRoot(remoteName)
	if err != nil {
		return err
	}
	if err := s.upsertSyncEntryForRow(root, *row); err != nil {
		return err
	}
	return s.refreshSyncRootDirtyBit(root.ID, remoteName)
}

func (s *Service) MarkLocalSynced(_ context.Context, remoteName, relPath string) error {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return fmt.Errorf("remote is required")
	}
	if relPath == "" {
		return fmt.Errorf("path is required")
	}

	localPath := buildLocalPath(remoteName, relPath)
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("stat local file: %w", err)
	}

	now := dbpkg.NowRFC3339()
	row, err := dbpkg.GetFileMetadata(s.database.Conn, remoteName, relPath)
	if err != nil {
		return err
	}
	if row == nil {
		row = &dbpkg.FileMetadata{
			RemoteName:    remoteName,
			RelPath:       relPath,
			ParentRelPath: parentPath(relPath),
			Name:          path.Base(relPath),
		}
	}

	row.IsDir = info.IsDir()
	row.ParentRelPath = parentPath(relPath)
	row.Name = path.Base(relPath)
	row.LocalExists = true
	row.LocalMTime = info.ModTime().UTC().Format(time.RFC3339Nano)
	row.LastLocalSeen = now
	if info.IsDir() {
		row.LocalSize = sql.NullInt64{}
	} else {
		row.LocalSize = sql.NullInt64{Int64: info.Size(), Valid: true}
	}
	row.LocalDirty = false
	row.LastComparedAt = now
	row.LastSyncedAt = now
	row.LastError = ""
	row.UpdatedAt = now

	if err := dbpkg.UpsertFileMetadata(s.database.Conn, *row); err != nil {
		return err
	}
	root, err := s.ensureSyncRoot(remoteName)
	if err != nil {
		return err
	}
	if err := s.upsertSyncEntryForRow(root, *row); err != nil {
		return err
	}
	return s.refreshSyncRootDirtyBit(root.ID, remoteName)
}

func (s *Service) WatchDir(remoteName, dirPath string) error {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return fmt.Errorf("remote is required")
	}
	now := dbpkg.NowRFC3339()
	return dbpkg.UpsertWatchedDir(s.database.Conn, dbpkg.WatchedDir{
		RemoteName: remoteName,
		RelPath:    dirPath,
		CreatedAt:  now,
		UpdatedAt:  now,
	})
}

func (s *Service) UnwatchDir(remoteName, dirPath string) error {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return fmt.Errorf("remote is required")
	}
	return dbpkg.DeleteWatchedDir(s.database.Conn, remoteName, dirPath)
}

func (s *Service) ListWatchedDirs() ([]dbpkg.WatchedDir, error) {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return nil, fmt.Errorf("sync metadata database unavailable")
	}
	return dbpkg.ListWatchedDirs(s.database.Conn)
}

func (s *Service) RefreshDirectory(ctx context.Context, remoteName, dirPath string) (*DirectoryResponse, error) {
	return s.refreshDirectory(ctx, remoteName, dirPath, true)
}

func (s *Service) refreshDirectoryStream(ctx context.Context, remoteName, dirPath string, reconcile bool,
	emit func(DirectoryStreamChunk) error) error {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return fmt.Errorf("remote is required")
	}
	if !rclone.RemoteExists(remoteName) {
		return fmt.Errorf("remote not found")
	}
	root, err := s.ensureSyncRoot(remoteName)
	if err != nil {
		return err
	}

	localItems, err := scanLocalDirectory(buildLocalPath(remoteName, dirPath))
	if err != nil {
		return err
	}
	existingRows, err := dbpkg.ListFileMetadataByParent(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return err
	}

	existingByName := make(map[string]dbpkg.FileMetadata, len(existingRows))
	for _, row := range existingRows {
		existingByName[row.Name] = row
	}

	const batchSize = 128
	batch := make([]DirectoryItem, 0, batchSize)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		items := append([]DirectoryItem(nil), batch...)
		batch = batch[:0]
		return emit(DirectoryStreamChunk{
			Type:   "items",
			Remote: remoteName,
			Path:   dirPath,
			Items:  items,
		})
	}

	now := dbpkg.NowRFC3339()
	seenNames := make(map[string]struct{}, len(existingByName))
	processRow := func(name string, remoteItem rclone.FileItem, hasRemote bool) error {
		prev, hadPrev := existingByName[name]
		localItem, hasLocal := localItems[name]

		row := dbpkg.FileMetadata{
			RemoteName:    remoteName,
			ParentRelPath: dirPath,
			Name:          name,
			UpdatedAt:     now,
		}
		if hadPrev {
			row = prev
			row.UpdatedAt = now
		}

		relPath := ""
		if hasRemote {
			relPath = remoteItem.Path
		} else if hadPrev {
			relPath = prev.RelPath
		} else {
			relPath = joinRemotePath(dirPath, name)
		}
		row.RelPath = relPath
		row.ParentRelPath = dirPath
		row.Name = name

		row.LocalExists = hasLocal
		if hasLocal {
			row.IsDir = row.IsDir || localItem.isDir
			row.LocalMTime = localItem.modTime
			row.LocalSize = sql.NullInt64{Int64: localItem.size, Valid: !localItem.isDir}
			row.LastLocalSeen = now
		} else {
			row.LocalMTime = ""
			row.LocalSize = sql.NullInt64{}
			if hadPrev {
				row.LastLocalSeen = now
			}
		}

		row.RemoteExists = hasRemote
		if hasRemote {
			row.IsDir = row.IsDir || remoteItem.IsDir
			row.RemoteMTime = remoteItem.ModTime.UTC().Format(time.RFC3339Nano)
			row.RemoteSize = sql.NullInt64{Int64: remoteItem.Size, Valid: !remoteItem.IsDir}
			row.RemoteRevision = ""
			row.MimeType = remoteItem.MimeType
			row.LastRemoteSeen = now
		} else {
			row.RemoteMTime = ""
			row.RemoteSize = sql.NullInt64{}
			row.RemoteRevision = ""
			if hadPrev {
				row.LastRemoteSeen = now
			}
		}

		if localObservationChanged(prev, row) {
			row.LocalDirty = true
			if row.LastLocalEvent == "" {
				row.LastLocalEvent = now
			}
		}

		row.LastComparedAt = now
		row.LastError = ""

		if hasRemote && remoteItem.HashAlgo != "" && remoteItem.Hash != "" {
			if err := dbpkg.UpsertFileHash(s.database.Conn, dbpkg.FileHash{
				RemoteName:    remoteName,
				RelPath:       row.RelPath,
				Side:          "remote",
				Algorithm:     remoteItem.HashAlgo,
				HashValue:     remoteItem.Hash,
				ObservedMTime: row.RemoteMTime,
				ObservedSize:  row.RemoteSize,
				ComputedAt:    now,
			}); err != nil {
				return err
			}
		}

		if !row.LocalExists && !row.RemoteExists {
			if hadPrev {
				_ = dbpkg.DeleteSyncEntry(s.database.Conn, dbpkg.MakeSyncEntryID(root.ID, row.RelPath))
				if err := dbpkg.DeleteFileMetadata(s.database.Conn, remoteName, row.RelPath); err != nil {
					return err
				}
			}
			return nil
		}

		if reconcile {
			if err := s.reconcileObservedEntry(ctx, &row, remoteItem, hadPrev, prev, now); err != nil {
				row.LastError = err.Error()
			}
		}

		if err := dbpkg.UpsertFileMetadata(s.database.Conn, row); err != nil {
			return err
		}
		if err := s.upsertSyncEntryForRow(root, row); err != nil {
			return err
		}
		batch = append(batch, directoryItemForRow(remoteName, row))
		if len(batch) >= batchSize {
			return flush()
		}
		return nil
	}

	if err := rclone.ListDirStream(ctx, remoteName, dirPath, func(item rclone.FileItem) error {
		seenNames[item.Name] = struct{}{}
		return processRow(item.Name, item, true)
	}); err != nil {
		if isMissingDirectoryError(err) {
			if pruneErr := s.pruneMissingRemoteDirectory(root, remoteName, dirPath); pruneErr != nil {
				return pruneErr
			}
			return s.streamDirectoryRows(remoteName, dirPath, nil, emit)
		}
		return err
	}

	remainingNames := make(map[string]struct{}, len(localItems)+len(existingByName))
	for name := range localItems {
		if _, seen := seenNames[name]; !seen {
			remainingNames[name] = struct{}{}
		}
	}
	for name := range existingByName {
		if _, seen := seenNames[name]; !seen {
			remainingNames[name] = struct{}{}
		}
	}
	for name := range remainingNames {
		if err := processRow(name, rclone.FileItem{}, false); err != nil {
			return err
		}
	}

	stillDirty, err := dbpkg.RemoteHasDirtyEntries(s.database.Conn, remoteName)
	if err != nil {
		return err
	}
	if err := dbpkg.SetSyncRootDirtyBit(s.database.Conn, root.ID, stillDirty, now); err != nil {
		return err
	}
	if err := flush(); err != nil {
		return err
	}
	watched, err := dbpkg.IsWatchedDir(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return err
	}
	return emit(DirectoryStreamChunk{
		Type:     "done",
		Remote:   remoteName,
		Path:     dirPath,
		DirtyBit: stillDirty,
		Watched:  watched,
	})
}

func (s *Service) refreshDirectory(ctx context.Context, remoteName, dirPath string, reconcile bool) (*DirectoryResponse, error) {
	if s == nil || s.database == nil || s.database.Conn == nil {
		return nil, fmt.Errorf("sync metadata database unavailable")
	}
	if remoteName == "" {
		return nil, fmt.Errorf("remote is required")
	}
	if !rclone.RemoteExists(remoteName) {
		return nil, fmt.Errorf("remote not found")
	}
	root, err := s.ensureSyncRoot(remoteName)
	if err != nil {
		return nil, err
	}

	remoteItems, err := rclone.ListDir(ctx, remoteName, dirPath)
	if err != nil {
		if isMissingDirectoryError(err) {
			if pruneErr := s.pruneMissingRemoteDirectory(root, remoteName, dirPath); pruneErr != nil {
				return nil, pruneErr
			}
			return s.emptyDirectoryResponse(remoteName, dirPath)
		}
		return nil, err
	}
	localItems, err := scanLocalDirectory(buildLocalPath(remoteName, dirPath))
	if err != nil {
		return nil, err
	}

	existingRows, err := dbpkg.ListFileMetadataByParent(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return nil, err
	}

	existingByName := make(map[string]dbpkg.FileMetadata, len(existingRows))
	for _, row := range existingRows {
		existingByName[row.Name] = row
	}

	remoteByName := make(map[string]rclone.FileItem, len(remoteItems))
	for _, item := range remoteItems {
		remoteByName[item.Name] = item
	}

	names := make(map[string]struct{}, len(remoteByName)+len(localItems)+len(existingByName))
	for name := range remoteByName {
		names[name] = struct{}{}
	}
	for name := range localItems {
		names[name] = struct{}{}
	}
	for name := range existingByName {
		names[name] = struct{}{}
	}

	now := dbpkg.NowRFC3339()
	for name := range names {
		prev, hadPrev := existingByName[name]
		remoteItem, hasRemote := remoteByName[name]
		localItem, hasLocal := localItems[name]

		row := dbpkg.FileMetadata{
			RemoteName:    remoteName,
			ParentRelPath: dirPath,
			Name:          name,
			UpdatedAt:     now,
		}
		if hadPrev {
			row = prev
			row.UpdatedAt = now
		}

		relPath := ""
		if hasRemote {
			relPath = remoteItem.Path
		} else if hadPrev {
			relPath = prev.RelPath
		} else {
			relPath = joinRemotePath(dirPath, name)
		}
		row.RelPath = relPath
		row.ParentRelPath = dirPath
		row.Name = name

		row.LocalExists = hasLocal
		if hasLocal {
			row.IsDir = row.IsDir || localItem.isDir
			row.LocalMTime = localItem.modTime
			row.LocalSize = sql.NullInt64{Int64: localItem.size, Valid: !localItem.isDir}
			row.LastLocalSeen = now
		} else {
			row.LocalMTime = ""
			row.LocalSize = sql.NullInt64{}
			if hadPrev {
				row.LastLocalSeen = now
			}
		}

		row.RemoteExists = hasRemote
		if hasRemote {
			row.IsDir = row.IsDir || remoteItem.IsDir
			row.RemoteMTime = remoteItem.ModTime.UTC().Format(time.RFC3339Nano)
			row.RemoteSize = sql.NullInt64{Int64: remoteItem.Size, Valid: !remoteItem.IsDir}
			row.RemoteRevision = ""
			row.MimeType = remoteItem.MimeType
			row.LastRemoteSeen = now
		} else {
			row.RemoteMTime = ""
			row.RemoteSize = sql.NullInt64{}
			row.RemoteRevision = ""
			if hadPrev {
				row.LastRemoteSeen = now
			}
		}

		if localObservationChanged(prev, row) {
			row.LocalDirty = true
			if row.LastLocalEvent == "" {
				row.LastLocalEvent = now
			}
		}

		row.LastComparedAt = now
		row.LastError = ""

		if hasRemote && remoteItem.HashAlgo != "" && remoteItem.Hash != "" {
			if err := dbpkg.UpsertFileHash(s.database.Conn, dbpkg.FileHash{
				RemoteName:    remoteName,
				RelPath:       row.RelPath,
				Side:          "remote",
				Algorithm:     remoteItem.HashAlgo,
				HashValue:     remoteItem.Hash,
				ObservedMTime: row.RemoteMTime,
				ObservedSize:  row.RemoteSize,
				ComputedAt:    now,
			}); err != nil {
				return nil, err
			}
		}

		if !row.LocalExists && !row.RemoteExists {
			if hadPrev {
				_ = dbpkg.DeleteSyncEntry(s.database.Conn, dbpkg.MakeSyncEntryID(root.ID, row.RelPath))
				if err := dbpkg.DeleteFileMetadata(s.database.Conn, remoteName, row.RelPath); err != nil {
					return nil, err
				}
			}
			continue
		}

		if reconcile {
			if err := s.reconcileObservedEntry(ctx, &row, remoteItem, hadPrev, prev, now); err != nil {
				row.LastError = err.Error()
			}
		}

		if err := dbpkg.UpsertFileMetadata(s.database.Conn, row); err != nil {
			return nil, err
		}
		if err := s.upsertSyncEntryForRow(root, row); err != nil {
			return nil, err
		}
	}
	stillDirty, err := dbpkg.RemoteHasDirtyEntries(s.database.Conn, remoteName)
	if err != nil {
		return nil, err
	}
	if err := dbpkg.SetSyncRootDirtyBit(s.database.Conn, root.ID, stillDirty, now); err != nil {
		return nil, err
	}

	rows, err := dbpkg.ListFileMetadataByParent(s.database.Conn, remoteName, dirPath)
	if err != nil {
		return nil, err
	}
	return s.directoryResponseFromRows(remoteName, dirPath, rows)
}

type localDirItem struct {
	name    string
	isDir   bool
	size    int64
	modTime string
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

func (s *Service) reconcileObservedEntry(ctx context.Context, row *dbpkg.FileMetadata, remoteItem rclone.FileItem, hadPrev bool, prev dbpkg.FileMetadata, now string) error {
	remoteChanged := hadPrev && remoteObservationChanged(prev, *row)
	localChanged := row.LocalDirty || (hadPrev && localObservationChanged(prev, *row)) || (!hadPrev && row.LocalExists)

	if row.IsDir {
		return s.reconcileDirectoryEntry(ctx, row, remoteChanged || !hadPrev, localChanged, now)
	}
	return s.reconcileFileEntry(ctx, row, remoteItem, remoteChanged || (!hadPrev && row.RemoteExists), localChanged, now)
}

func (s *Service) reconcileDirectoryEntry(ctx context.Context, row *dbpkg.FileMetadata, remoteChanged, localChanged bool, now string) error {
	switch {
	case row.LocalDirty && row.LocalExists && !row.RemoteExists:
		if err := rclone.MkDir(ctx, row.RemoteName, row.RelPath); err != nil {
			return fmt.Errorf("mkdir remote: %w", err)
		}
		row.RemoteExists = true
		row.LocalDirty = false
		row.LastSyncedAt = now
	case row.LocalDirty && !row.LocalExists && row.RemoteExists:
		if err := rclone.DeletePath(ctx, row.RemoteName, row.RelPath); err != nil {
			return fmt.Errorf("delete remote dir: %w", err)
		}
		row.RemoteExists = false
		row.LocalDirty = false
		row.LastSyncedAt = now
	case !row.RemoteExists && row.LocalExists && !localChanged && remoteChanged:
		if err := os.RemoveAll(buildLocalPath(row.RemoteName, row.RelPath)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove local dir: %w", err)
		}
		row.LocalExists = false
		row.LastLocalSeen = now
		row.LastSyncedAt = now
	case row.LocalExists && row.RemoteExists && row.LocalDirty:
		row.LocalDirty = false
		row.LastSyncedAt = now
	}
	return nil
}

func (s *Service) reconcileFileEntry(ctx context.Context, row *dbpkg.FileMetadata, remoteItem rclone.FileItem, remoteChanged, localChanged bool, now string) error {
	switch {
	case row.LocalDirty && !row.LocalExists && row.RemoteExists:
		if remoteChanged {
			return s.pullFile(ctx, row, remoteItem, now, false)
		}
		if err := rclone.DeletePath(ctx, row.RemoteName, row.RelPath); err != nil {
			return fmt.Errorf("delete remote file: %w", err)
		}
		row.RemoteExists = false
		row.LocalDirty = false
		row.LastSyncedAt = now
		return nil

	case row.LocalDirty && row.LocalExists && !row.RemoteExists:
		return s.pushFile(ctx, row, now)

	case row.LocalDirty && row.LocalExists && row.RemoteExists:
		same, err := s.contentsEqual(ctx, *row, remoteItem)
		if err != nil {
			return err
		}
		if same {
			row.LocalDirty = false
			row.LastSyncedAt = now
			return nil
		}
		if remoteChanged {
			if localDefinitelyNewer(*row, remoteChanged) {
				return s.pushFile(ctx, row, now)
			}
			return s.pullFile(ctx, row, remoteItem, now, true)
		}
		return s.pushFile(ctx, row, now)

	case !row.LocalDirty && !row.RemoteExists && row.LocalExists && remoteChanged:
		localPath := buildLocalPath(row.RemoteName, row.RelPath)
		if err := os.Remove(localPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove local file: %w", err)
		}
		row.LocalExists = false
		row.LastLocalSeen = now
		row.LastSyncedAt = now
		return nil

	case !row.LocalDirty && row.RemoteExists && row.LocalExists && remoteChanged:
		same, err := s.contentsEqual(ctx, *row, remoteItem)
		if err != nil {
			return err
		}
		if same {
			row.LastSyncedAt = now
			return nil
		}
		return s.pullFile(ctx, row, remoteItem, now, false)

	case !row.LocalDirty && row.RemoteExists && row.LocalExists && !remoteChanged && localChanged:
		same, err := s.contentsEqual(ctx, *row, remoteItem)
		if err != nil {
			return err
		}
		if same {
			row.LocalDirty = false
			row.LastSyncedAt = now
			return nil
		}
		return s.pushFile(ctx, row, now)
	}
	return nil
}

func (s *Service) pushFile(ctx context.Context, row *dbpkg.FileMetadata, now string) error {
	localPath := buildLocalPath(row.RemoteName, row.RelPath)
	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open local file: %w", err)
	}
	defer file.Close()

	size := int64(0)
	if row.LocalSize.Valid {
		size = row.LocalSize.Int64
	}
	if err := rclone.UploadFile(ctx, row.RemoteName, parentPath(row.RelPath), path.Base(row.RelPath), size, file); err != nil {
		return fmt.Errorf("upload remote file: %w", err)
	}

	row.RemoteExists = true
	row.RemoteMTime = row.LocalMTime
	row.RemoteSize = row.LocalSize
	row.LocalDirty = false
	row.LastSyncedAt = now

	remoteHash, _ := dbpkg.GetFileHash(s.database.Conn, row.RemoteName, row.RelPath, "remote")
	localHash, err := s.computeLocalHash(row.RemoteName, row.RelPath, preferredHashAlgorithm(remoteHash))
	if err == nil && localHash != nil {
		if err := dbpkg.UpsertFileHash(s.database.Conn, *localHash); err != nil {
			return err
		}
		if err := dbpkg.UpsertFileHash(s.database.Conn, dbpkg.FileHash{
			RemoteName:    row.RemoteName,
			RelPath:       row.RelPath,
			Side:          "remote",
			Algorithm:     localHash.Algorithm,
			HashValue:     localHash.HashValue,
			ObservedMTime: row.RemoteMTime,
			ObservedSize:  row.RemoteSize,
			ComputedAt:    now,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) pullFile(ctx context.Context, row *dbpkg.FileMetadata, remoteItem rclone.FileItem, now string, backupLocal bool) error {
	localPath := buildLocalPath(row.RemoteName, row.RelPath)
	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return fmt.Errorf("mkdir local parent: %w", err)
	}

	if backupLocal && row.LocalExists {
		backupPath := localPath + ".tmp"
		_ = os.Remove(backupPath)
		if err := os.Rename(localPath, backupPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("stash local file: %w", err)
		}
	}

	file, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("create local file: %w", err)
	}
	defer file.Close()

	if _, err := rclone.DownloadFile(ctx, row.RemoteName, row.RelPath, file); err != nil {
		return fmt.Errorf("download remote file: %w", err)
	}
	if !remoteItem.ModTime.IsZero() {
		_ = os.Chtimes(localPath, remoteItem.ModTime, remoteItem.ModTime)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close local file: %w", err)
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("stat local file: %w", err)
	}

	row.LocalExists = true
	row.LocalMTime = info.ModTime().UTC().Format(time.RFC3339Nano)
	row.LocalSize = sql.NullInt64{Int64: info.Size(), Valid: true}
	row.LocalDirty = false
	row.LastLocalSeen = now
	row.LastSyncedAt = now

	remoteHash, _ := dbpkg.GetFileHash(s.database.Conn, row.RemoteName, row.RelPath, "remote")
	localHash, err := s.computeLocalHash(row.RemoteName, row.RelPath, preferredHashAlgorithm(remoteHash))
	if err == nil && localHash != nil {
		if err := dbpkg.UpsertFileHash(s.database.Conn, *localHash); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) contentsEqual(ctx context.Context, row dbpkg.FileMetadata, remoteItem rclone.FileItem) (bool, error) {
	if row.IsDir {
		return true, nil
	}
	if row.LocalExists && row.RemoteExists &&
		row.LocalSize.Valid && row.RemoteSize.Valid &&
		row.LocalSize.Int64 >= 0 && row.RemoteSize.Int64 >= 0 &&
		row.LocalSize.Int64 != row.RemoteSize.Int64 {
		return false, nil
	}

	remoteHash, err := dbpkg.GetFileHash(s.database.Conn, row.RemoteName, row.RelPath, "remote")
	if err != nil {
		return false, err
	}
	if remoteItem.HashAlgo != "" && remoteItem.Hash != "" {
		remoteHash = &dbpkg.FileHash{
			RemoteName:    row.RemoteName,
			RelPath:       row.RelPath,
			Side:          "remote",
			Algorithm:     remoteItem.HashAlgo,
			HashValue:     remoteItem.Hash,
			ObservedMTime: row.RemoteMTime,
			ObservedSize:  row.RemoteSize,
			ComputedAt:    dbpkg.NowRFC3339(),
		}
	}
	if remoteHash != nil && row.LocalExists {
		localHash, err := s.computeLocalHash(row.RemoteName, row.RelPath, preferredHashAlgorithm(remoteHash))
		if err != nil {
			return false, err
		}
		if localHash != nil {
			if err := dbpkg.UpsertFileHash(s.database.Conn, *localHash); err != nil {
				return false, err
			}
			return localHash.Algorithm == remoteHash.Algorithm && localHash.HashValue == remoteHash.HashValue, nil
		}
	}

	localTime, localOK := parseTime(row.LocalMTime)
	remoteTime, remoteOK := parseTime(row.RemoteMTime)
	if !localOK || !remoteOK {
		return false, nil
	}
	diff := localTime.Sub(remoteTime)
	if diff < 0 {
		diff = -diff
	}
	if row.LocalSize.Valid && row.RemoteSize.Valid && row.LocalSize.Int64 >= 0 && row.RemoteSize.Int64 >= 0 {
		return diff <= 2*time.Second && row.LocalSize.Int64 == row.RemoteSize.Int64, nil
	}
	return diff <= 2*time.Second, nil
}

func (s *Service) computeLocalHash(remoteName, relPath, algorithm string) (*dbpkg.FileHash, error) {
	localPath := buildLocalPath(remoteName, relPath)
	info, err := os.Stat(localPath)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, nil
	}

	existing, err := dbpkg.GetFileHash(s.database.Conn, remoteName, relPath, "local")
	if err != nil {
		return nil, err
	}
	mtime := info.ModTime().UTC().Format(time.RFC3339Nano)
	size := sql.NullInt64{Int64: info.Size(), Valid: true}
	if existing != nil && existing.Algorithm == algorithm && existing.ObservedMTime == mtime && existing.ObservedSize.Valid && existing.ObservedSize.Int64 == size.Int64 {
		return existing, nil
	}

	hashAlgo, hasher := newFileHasher(algorithm)

	file, err := os.Open(localPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if _, err := io.Copy(hasher, file); err != nil {
		return nil, err
	}
	value := hex.EncodeToString(hasher.Sum(nil))
	return &dbpkg.FileHash{
		RemoteName:    remoteName,
		RelPath:       relPath,
		Side:          "local",
		Algorithm:     hashAlgo,
		HashValue:     value,
		ObservedMTime: mtime,
		ObservedSize:  size,
		ComputedAt:    dbpkg.NowRFC3339(),
	}, nil
}

func deriveDirectoryItemState(row dbpkg.FileMetadata) (state string, dirty bool, direction string) {
	switch {
	case row.LocalDirty && row.LocalExists && !row.RemoteExists:
		if row.IsDir {
			return "LOC", true, "push"
		}
		return "LOC", true, "push"
	case row.LocalDirty && !row.LocalExists && row.RemoteExists:
		return "MOD", true, "push"
	case row.LocalDirty && row.LocalExists && row.RemoteExists:
		return "MOD", true, "push"
	case row.RemoteExists && !row.LocalExists:
		return "REM", false, "none"
	case row.LocalExists && row.RemoteExists:
		return "LOC", false, "none"
	case row.LocalExists && !row.RemoteExists:
		return "LOC", true, "push"
	default:
		return "REM", false, "none"
	}
}

func deriveDirectoryItemReason(row dbpkg.FileMetadata) string {
	var reason string

	switch {
	case row.LocalDirty && row.LocalExists && row.RemoteExists:
		if row.LocalSize.Valid && row.RemoteSize.Valid &&
			row.LocalSize.Int64 >= 0 && row.RemoteSize.Int64 >= 0 &&
			row.LocalSize.Int64 != row.RemoteSize.Int64 {
			reason = fmt.Sprintf("Local size %d B differs from remote size %d B.", row.LocalSize.Int64, row.RemoteSize.Int64)
		} else if row.LocalMTime != "" && row.RemoteMTime != "" && !timesEqual(row.LocalMTime, row.RemoteMTime) {
			reason = "Local modified time differs from remote."
		} else {
			reason = "Local copy differs from remote and is pending upload."
		}
	case row.LocalDirty && row.LocalExists && !row.RemoteExists:
		reason = "Exists locally but not on remote; pending upload."
	case row.LocalDirty && !row.LocalExists && row.RemoteExists:
		reason = "Missing locally while remote copy exists; pending reconcile."
	case row.RemoteExists && !row.LocalExists:
		reason = "Remote-only file."
	case row.LocalExists && row.RemoteExists:
		reason = "Local and remote copies match."
	case row.LocalExists && !row.RemoteExists:
		reason = "Local-only file."
	default:
		reason = ""
	}

	if row.LastError != "" {
		if reason != "" {
			reason += " "
		}
		reason += "Last sync error: " + row.LastError
	}

	return reason
}

func localObservationChanged(prev, current dbpkg.FileMetadata) bool {
	return prev.LocalExists != current.LocalExists ||
		!timesEqual(prev.LocalMTime, current.LocalMTime) ||
		prev.LocalSize.Int64 != current.LocalSize.Int64 ||
		prev.LocalSize.Valid != current.LocalSize.Valid
}

func remoteObservationChanged(prev, current dbpkg.FileMetadata) bool {
	return prev.RemoteExists != current.RemoteExists ||
		!timesEqual(prev.RemoteMTime, current.RemoteMTime) ||
		sizeMeaningfullyChanged(prev.RemoteSize, current.RemoteSize) ||
		prev.RemoteRevision != current.RemoteRevision
}

func timesEqual(lhs, rhs string) bool {
	if lhs == rhs {
		return true
	}
	left, leftOK := parseTime(lhs)
	right, rightOK := parseTime(rhs)
	if leftOK && rightOK {
		return left.Equal(right)
	}
	return false
}

func sizeMeaningfullyChanged(prev, current sql.NullInt64) bool {
	if prev.Valid != current.Valid {
		return true
	}
	if !prev.Valid {
		return false
	}
	if prev.Int64 < 0 || current.Int64 < 0 {
		return false
	}
	return prev.Int64 != current.Int64
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

func parentPath(relPath string) string {
	parent := path.Dir(relPath)
	if parent == "." {
		return ""
	}
	return parent
}

func joinRemotePath(parentRelPath, name string) string {
	if parentRelPath == "" {
		return name
	}
	return path.Join(parentRelPath, name)
}

func buildLocalPath(remoteName, relPath string) string {
	remoteType := rclone.GetRemoteType(remoteName)
	providerFolder, folderName, root := resolveMountMapping(remoteName, remoteType)
	pathParts := []string{root}
	if providerFolder != "" {
		pathParts = append(pathParts, providerFolder)
	}
	if folderName != "" {
		pathParts = append(pathParts, folderName)
	}
	if relPath != "" {
		pathParts = append(pathParts, filepath.FromSlash(relPath))
	}
	return filepath.Join(pathParts...)
}

func preferredHashAlgorithm(remoteHash *dbpkg.FileHash) string {
	if remoteHash != nil && remoteHash.Algorithm != "" {
		return remoteHash.Algorithm
	}
	return "CRC-32"
}

func newFileHasher(algorithm string) (string, hash.Hash) {
	switch strings.ToUpper(strings.ReplaceAll(algorithm, "-", "")) {
	case "MD5":
		return "MD5", md5.New()
	case "SHA1":
		return "SHA-1", sha1.New()
	default:
		return "CRC-32", crc32.NewIEEE()
	}
}

func localDefinitelyNewer(row dbpkg.FileMetadata, remoteChanged bool) bool {
	if !remoteChanged {
		return true
	}
	localTime, localOK := parseTime(row.LocalMTime)
	remoteTime, remoteOK := parseTime(row.RemoteMTime)
	if !localOK {
		return false
	}
	if !remoteOK {
		return true
	}
	return localTime.After(remoteTime)
}
