package db

import (
	"database/sql"
	"fmt"
	"time"
)

type SyncRoot struct {
	ID             string
	RemoteName     string
	RemoteType     string
	ProviderFolder string
	FolderName     string
	MountRoot      string
	Enabled        bool
	DirtyBit       bool
	LastRefetchAt  string
	LastPollAt     string
	CreatedAt      string
	UpdatedAt      string
}

type SyncEntry struct {
	ID             string
	RootID         string
	RelPath        string
	ParentRelPath  string
	Name           string
	IsDir          bool
	LocalExists    bool
	RemoteExists   bool
	IsDirty        bool
	SyncDirection  string
	LocalMTime     string
	LocalSize      sql.NullInt64
	RemoteMTime    string
	RemoteSize     sql.NullInt64
	RemoteRevision string
	MimeType       string
	StateCode      string
	LastSeenLocal  string
	LastSeenRemote string
	CreatedAt      string
	UpdatedAt      string
}

func UpsertSyncRoot(exec sqlExecer, root SyncRoot) error {
	_, err := exec.Exec(`
		INSERT INTO sync_roots (
			id, remote_name, remote_type, provider_folder, folder_name, mount_root,
			enabled, dirty_bit, last_refetch_at, last_poll_at, created_at, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			remote_name = excluded.remote_name,
			remote_type = excluded.remote_type,
			provider_folder = excluded.provider_folder,
			folder_name = excluded.folder_name,
			mount_root = excluded.mount_root,
			enabled = excluded.enabled,
			dirty_bit = excluded.dirty_bit,
			last_refetch_at = excluded.last_refetch_at,
			last_poll_at = excluded.last_poll_at,
			updated_at = excluded.updated_at
	`, root.ID, root.RemoteName, root.RemoteType, root.ProviderFolder, root.FolderName, root.MountRoot,
		boolToInt(root.Enabled), boolToInt(root.DirtyBit), nullIfEmpty(root.LastRefetchAt), nullIfEmpty(root.LastPollAt), root.CreatedAt, root.UpdatedAt)
	return err
}

func GetSyncRootByRemoteName(conn *sql.DB, remoteName string) (*SyncRoot, error) {
	root := &SyncRoot{}
	var enabled, dirtyBit int
	var lastRefetch, lastPoll sql.NullString
	err := conn.QueryRow(`
		SELECT id, remote_name, remote_type, provider_folder, folder_name, mount_root,
		       enabled, dirty_bit, last_refetch_at, last_poll_at, created_at, updated_at
		FROM sync_roots
		WHERE remote_name = ?
	`, remoteName).Scan(
		&root.ID, &root.RemoteName, &root.RemoteType, &root.ProviderFolder, &root.FolderName, &root.MountRoot,
		&enabled, &dirtyBit, &lastRefetch, &lastPoll, &root.CreatedAt, &root.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	root.Enabled = enabled != 0
	root.DirtyBit = dirtyBit != 0
	root.LastRefetchAt = lastRefetch.String
	root.LastPollAt = lastPoll.String
	return root, nil
}

func UpsertSyncEntry(exec sqlExecer, entry SyncEntry) error {
	_, err := exec.Exec(`
		INSERT INTO sync_entries (
			id, root_id, rel_path, parent_rel_path, name, is_dir, local_exists, remote_exists,
			is_dirty, sync_direction, local_mtime, local_size, remote_mtime, remote_size,
			remote_revision, mime_type, state_code, last_seen_local_at, last_seen_remote_at,
			created_at, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			parent_rel_path = excluded.parent_rel_path,
			name = excluded.name,
			is_dir = excluded.is_dir,
			local_exists = excluded.local_exists,
			remote_exists = excluded.remote_exists,
			is_dirty = excluded.is_dirty,
			sync_direction = excluded.sync_direction,
			local_mtime = excluded.local_mtime,
			local_size = excluded.local_size,
			remote_mtime = excluded.remote_mtime,
			remote_size = excluded.remote_size,
			remote_revision = excluded.remote_revision,
			mime_type = excluded.mime_type,
			state_code = excluded.state_code,
			last_seen_local_at = excluded.last_seen_local_at,
			last_seen_remote_at = excluded.last_seen_remote_at,
			updated_at = excluded.updated_at
	`, entry.ID, entry.RootID, entry.RelPath, entry.ParentRelPath, entry.Name, boolToInt(entry.IsDir),
		boolToInt(entry.LocalExists), boolToInt(entry.RemoteExists), boolToInt(entry.IsDirty),
		entry.SyncDirection, nullIfEmpty(entry.LocalMTime), nullableInt(entry.LocalSize),
		nullIfEmpty(entry.RemoteMTime), nullableInt(entry.RemoteSize), nullIfEmpty(entry.RemoteRevision),
		entry.MimeType, entry.StateCode, nullIfEmpty(entry.LastSeenLocal), nullIfEmpty(entry.LastSeenRemote),
		entry.CreatedAt, entry.UpdatedAt)
	return err
}

func ListSyncEntriesByParent(conn *sql.DB, rootID, parentRelPath string) ([]SyncEntry, error) {
	rows, err := conn.Query(`
		SELECT id, root_id, rel_path, parent_rel_path, name, is_dir, local_exists, remote_exists,
		       is_dirty, sync_direction, local_mtime, local_size, remote_mtime, remote_size,
		       remote_revision, mime_type, state_code, last_seen_local_at, last_seen_remote_at,
		       created_at, updated_at
		FROM sync_entries
		WHERE root_id = ? AND parent_rel_path = ?
		ORDER BY is_dir DESC, name COLLATE NOCASE ASC
	`, rootID, parentRelPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []SyncEntry
	for rows.Next() {
		var entry SyncEntry
		var isDir, localExists, remoteExists, isDirty int
		var localMTime, remoteMTime, remoteRevision, lastSeenLocal, lastSeenRemote sql.NullString
		if err := rows.Scan(
			&entry.ID, &entry.RootID, &entry.RelPath, &entry.ParentRelPath, &entry.Name, &isDir,
			&localExists, &remoteExists, &isDirty, &entry.SyncDirection, &localMTime, &entry.LocalSize,
			&remoteMTime, &entry.RemoteSize, &remoteRevision, &entry.MimeType, &entry.StateCode,
			&lastSeenLocal, &lastSeenRemote, &entry.CreatedAt, &entry.UpdatedAt,
		); err != nil {
			return nil, err
		}
		entry.IsDir = isDir != 0
		entry.LocalExists = localExists != 0
		entry.RemoteExists = remoteExists != 0
		entry.IsDirty = isDirty != 0
		entry.LocalMTime = localMTime.String
		entry.RemoteMTime = remoteMTime.String
		entry.RemoteRevision = remoteRevision.String
		entry.LastSeenLocal = lastSeenLocal.String
		entry.LastSeenRemote = lastSeenRemote.String
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func ListSyncEntryPathsByParent(conn *sql.DB, rootID, parentRelPath string) ([]string, error) {
	rows, err := conn.Query(`
		SELECT rel_path
		FROM sync_entries
		WHERE root_id = ? AND parent_rel_path = ?
	`, rootID, parentRelPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var paths []string
	for rows.Next() {
		var relPath string
		if err := rows.Scan(&relPath); err != nil {
			return nil, err
		}
		paths = append(paths, relPath)
	}
	return paths, rows.Err()
}

func DeleteSyncEntriesByPathPrefix(exec sqlExecer, rootID, relPath string) error {
	likePrefix := relPath
	if likePrefix != "" {
		likePrefix += "/%"
	}

	var (
		query string
		args  []any
	)
	if relPath == "" {
		query = `DELETE FROM sync_entries WHERE root_id = ?`
		args = []any{rootID}
	} else {
		query = `DELETE FROM sync_entries WHERE root_id = ? AND (rel_path = ? OR rel_path LIKE ?)`
		args = []any{rootID, relPath, likePrefix}
	}

	_, err := exec.Exec(query, args...)
	return err
}

func SetSyncRootDirtyBit(exec sqlExecer, rootID string, dirty bool, lastRefetchAt string) error {
	_, err := exec.Exec(`
		UPDATE sync_roots
		SET dirty_bit = ?, last_refetch_at = COALESCE(?, last_refetch_at), updated_at = ?
		WHERE id = ?
	`, boolToInt(dirty), nullIfEmpty(lastRefetchAt), NowRFC3339(), rootID)
	return err
}

func RootHasDirtyEntries(conn *sql.DB, rootID string) (bool, error) {
	var exists int
	if err := conn.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM sync_entries WHERE root_id = ? AND is_dirty = 1 LIMIT 1
		)
	`, rootID).Scan(&exists); err != nil {
		return false, err
	}
	return exists != 0, nil
}

type sqlExecer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func MakeSyncRootID(remoteName string) string {
	return remoteName
}

func MakeSyncEntryID(rootID, relPath string) string {
	return fmt.Sprintf("%s:%s", rootID, relPath)
}

func NowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableInt(value sql.NullInt64) any {
	if !value.Valid {
		return nil
	}
	return value.Int64
}
