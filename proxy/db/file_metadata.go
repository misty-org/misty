package db

import "database/sql"

type FileMetadata struct {
	RemoteName     string
	RelPath        string
	ParentRelPath  string
	Name           string
	IsDir          bool
	LocalExists    bool
	LocalMTime     string
	LocalSize      sql.NullInt64
	RemoteExists   bool
	RemoteMTime    string
	RemoteSize     sql.NullInt64
	RemoteRevision string
	MimeType       string
	LocalDirty     bool
	LastLocalEvent string
	LastLocalSeen  string
	LastRemoteSeen string
	LastComparedAt string
	LastSyncedAt   string
	LastError      string
	UpdatedAt      string
}

type WatchedDir struct {
	RemoteName string
	RelPath    string
	CreatedAt  string
	UpdatedAt  string
}

type FileHash struct {
	RemoteName    string
	RelPath       string
	Side          string
	Algorithm     string
	HashValue     string
	ObservedMTime string
	ObservedSize  sql.NullInt64
	ComputedAt    string
}

func UpsertFileMetadata(exec sqlExecer, row FileMetadata) error {
	_, err := exec.Exec(`
		INSERT INTO file_metadata (
			remote_name, rel_path, parent_rel_path, name, is_dir,
			local_exists, local_mtime, local_size,
			remote_exists, remote_mtime, remote_size, remote_revision, mime_type,
			local_dirty, last_local_event_at, last_local_seen_at, last_remote_seen_at,
			last_compared_at, last_synced_at, last_error, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(remote_name, rel_path) DO UPDATE SET
			parent_rel_path = excluded.parent_rel_path,
			name = excluded.name,
			is_dir = excluded.is_dir,
			local_exists = excluded.local_exists,
			local_mtime = excluded.local_mtime,
			local_size = excluded.local_size,
			remote_exists = excluded.remote_exists,
			remote_mtime = excluded.remote_mtime,
			remote_size = excluded.remote_size,
			remote_revision = excluded.remote_revision,
			mime_type = excluded.mime_type,
			local_dirty = excluded.local_dirty,
			last_local_event_at = excluded.last_local_event_at,
			last_local_seen_at = excluded.last_local_seen_at,
			last_remote_seen_at = excluded.last_remote_seen_at,
			last_compared_at = excluded.last_compared_at,
			last_synced_at = excluded.last_synced_at,
			last_error = excluded.last_error,
			updated_at = excluded.updated_at
	`,
		row.RemoteName, row.RelPath, row.ParentRelPath, row.Name, boolToInt(row.IsDir),
		boolToInt(row.LocalExists), nullIfEmpty(row.LocalMTime), nullableInt(row.LocalSize),
		boolToInt(row.RemoteExists), nullIfEmpty(row.RemoteMTime), nullableInt(row.RemoteSize),
		row.RemoteRevision, row.MimeType, boolToInt(row.LocalDirty),
		nullIfEmpty(row.LastLocalEvent), nullIfEmpty(row.LastLocalSeen), nullIfEmpty(row.LastRemoteSeen),
		nullIfEmpty(row.LastComparedAt), nullIfEmpty(row.LastSyncedAt), row.LastError, row.UpdatedAt,
	)
	return err
}

func GetFileMetadata(conn *sql.DB, remoteName, relPath string) (*FileMetadata, error) {
	row := &FileMetadata{}
	var isDir, localExists, remoteExists, localDirty int
	var localMTime, remoteMTime, lastLocalEvent, lastLocalSeen, lastRemoteSeen, lastCompared, lastSynced sql.NullString
	err := conn.QueryRow(`
		SELECT remote_name, rel_path, parent_rel_path, name, is_dir,
		       local_exists, local_mtime, local_size,
		       remote_exists, remote_mtime, remote_size, remote_revision, mime_type,
		       local_dirty, last_local_event_at, last_local_seen_at, last_remote_seen_at,
		       last_compared_at, last_synced_at, last_error, updated_at
		FROM file_metadata
		WHERE remote_name = ? AND rel_path = ?
	`, remoteName, relPath).Scan(
		&row.RemoteName, &row.RelPath, &row.ParentRelPath, &row.Name, &isDir,
		&localExists, &localMTime, &row.LocalSize,
		&remoteExists, &remoteMTime, &row.RemoteSize, &row.RemoteRevision, &row.MimeType,
		&localDirty, &lastLocalEvent, &lastLocalSeen, &lastRemoteSeen,
		&lastCompared, &lastSynced, &row.LastError, &row.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	row.IsDir = isDir != 0
	row.LocalExists = localExists != 0
	row.LocalMTime = localMTime.String
	row.RemoteExists = remoteExists != 0
	row.RemoteMTime = remoteMTime.String
	row.LocalDirty = localDirty != 0
	row.LastLocalEvent = lastLocalEvent.String
	row.LastLocalSeen = lastLocalSeen.String
	row.LastRemoteSeen = lastRemoteSeen.String
	row.LastComparedAt = lastCompared.String
	row.LastSyncedAt = lastSynced.String
	return row, nil
}

func ListFileMetadataByParent(conn *sql.DB, remoteName, parentRelPath string) ([]FileMetadata, error) {
	rows, err := conn.Query(`
		SELECT remote_name, rel_path, parent_rel_path, name, is_dir,
		       local_exists, local_mtime, local_size,
		       remote_exists, remote_mtime, remote_size, remote_revision, mime_type,
		       local_dirty, last_local_event_at, last_local_seen_at, last_remote_seen_at,
		       last_compared_at, last_synced_at, last_error, updated_at
		FROM file_metadata
		WHERE remote_name = ? AND parent_rel_path = ?
		ORDER BY name
	`, remoteName, parentRelPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FileMetadata
	for rows.Next() {
		var row FileMetadata
		var isDir, localExists, remoteExists, localDirty int
		var localMTime, remoteMTime, lastLocalEvent, lastLocalSeen, lastRemoteSeen, lastCompared, lastSynced sql.NullString
		if err := rows.Scan(
			&row.RemoteName, &row.RelPath, &row.ParentRelPath, &row.Name, &isDir,
			&localExists, &localMTime, &row.LocalSize,
			&remoteExists, &remoteMTime, &row.RemoteSize, &row.RemoteRevision, &row.MimeType,
			&localDirty, &lastLocalEvent, &lastLocalSeen, &lastRemoteSeen,
			&lastCompared, &lastSynced, &row.LastError, &row.UpdatedAt,
		); err != nil {
			return nil, err
		}
		row.IsDir = isDir != 0
		row.LocalExists = localExists != 0
		row.LocalMTime = localMTime.String
		row.RemoteExists = remoteExists != 0
		row.RemoteMTime = remoteMTime.String
		row.LocalDirty = localDirty != 0
		row.LastLocalEvent = lastLocalEvent.String
		row.LastLocalSeen = lastLocalSeen.String
		row.LastRemoteSeen = lastRemoteSeen.String
		row.LastComparedAt = lastCompared.String
		row.LastSyncedAt = lastSynced.String
		out = append(out, row)
	}
	return out, rows.Err()
}

func ListFileMetadataByRemote(conn *sql.DB, remoteName string) ([]FileMetadata, error) {
	rows, err := conn.Query(`
		SELECT remote_name, rel_path, parent_rel_path, name, is_dir,
		       local_exists, local_mtime, local_size,
		       remote_exists, remote_mtime, remote_size, remote_revision, mime_type,
		       local_dirty, last_local_event_at, last_local_seen_at, last_remote_seen_at,
		       last_compared_at, last_synced_at, last_error, updated_at
		FROM file_metadata
		WHERE remote_name = ?
		ORDER BY parent_rel_path, name
	`, remoteName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FileMetadata
	for rows.Next() {
		var row FileMetadata
		var isDir, localExists, remoteExists, localDirty int
		var localMTime, remoteMTime, lastLocalEvent, lastLocalSeen, lastRemoteSeen, lastCompared, lastSynced sql.NullString
		if err := rows.Scan(
			&row.RemoteName, &row.RelPath, &row.ParentRelPath, &row.Name, &isDir,
			&localExists, &localMTime, &row.LocalSize,
			&remoteExists, &remoteMTime, &row.RemoteSize, &row.RemoteRevision, &row.MimeType,
			&localDirty, &lastLocalEvent, &lastLocalSeen, &lastRemoteSeen,
			&lastCompared, &lastSynced, &row.LastError, &row.UpdatedAt,
		); err != nil {
			return nil, err
		}
		row.IsDir = isDir != 0
		row.LocalExists = localExists != 0
		row.LocalMTime = localMTime.String
		row.RemoteExists = remoteExists != 0
		row.RemoteMTime = remoteMTime.String
		row.LocalDirty = localDirty != 0
		row.LastLocalEvent = lastLocalEvent.String
		row.LastLocalSeen = lastLocalSeen.String
		row.LastRemoteSeen = lastRemoteSeen.String
		row.LastComparedAt = lastCompared.String
		row.LastSyncedAt = lastSynced.String
		out = append(out, row)
	}
	return out, rows.Err()
}

func DeleteFileMetadata(exec sqlExecer, remoteName, relPath string) error {
	_, err := exec.Exec(`DELETE FROM file_metadata WHERE remote_name = ? AND rel_path = ?`, remoteName, relPath)
	return err
}

func RemoteHasDirtyEntries(conn *sql.DB, remoteName string) (bool, error) {
	var exists int
	if err := conn.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM file_metadata
			WHERE remote_name = ? AND local_dirty = 1
			LIMIT 1
		)
	`, remoteName).Scan(&exists); err != nil {
		return false, err
	}
	return exists != 0, nil
}

func UpsertWatchedDir(exec sqlExecer, row WatchedDir) error {
	_, err := exec.Exec(`
		INSERT INTO watched_dirs (remote_name, rel_path, created_at, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(remote_name, rel_path) DO UPDATE SET
			updated_at = excluded.updated_at
	`, row.RemoteName, row.RelPath, row.CreatedAt, row.UpdatedAt)
	return err
}

func DeleteWatchedDir(exec sqlExecer, remoteName, relPath string) error {
	_, err := exec.Exec(`DELETE FROM watched_dirs WHERE remote_name = ? AND rel_path = ?`, remoteName, relPath)
	return err
}

func ListWatchedDirs(conn *sql.DB) ([]WatchedDir, error) {
	rows, err := conn.Query(`
		SELECT remote_name, rel_path, created_at, updated_at
		FROM watched_dirs
		ORDER BY remote_name, rel_path
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WatchedDir
	for rows.Next() {
		var row WatchedDir
		if err := rows.Scan(&row.RemoteName, &row.RelPath, &row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func IsWatchedDir(conn *sql.DB, remoteName, relPath string) (bool, error) {
	var exists int
	if err := conn.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM watched_dirs
			WHERE remote_name = ? AND rel_path = ?
			LIMIT 1
		)
	`, remoteName, relPath).Scan(&exists); err != nil {
		return false, err
	}
	return exists != 0, nil
}

func UpsertFileHash(exec sqlExecer, row FileHash) error {
	_, err := exec.Exec(`
		INSERT INTO file_hash (
			remote_name, rel_path, side, algorithm, hash_value, observed_mtime, observed_size, computed_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(remote_name, rel_path, side, algorithm) DO UPDATE SET
			hash_value = excluded.hash_value,
			observed_mtime = excluded.observed_mtime,
			observed_size = excluded.observed_size,
			computed_at = excluded.computed_at
	`, row.RemoteName, row.RelPath, row.Side, row.Algorithm, row.HashValue,
		nullIfEmpty(row.ObservedMTime), nullableInt(row.ObservedSize), row.ComputedAt)
	return err
}

func GetFileHash(conn *sql.DB, remoteName, relPath, side string) (*FileHash, error) {
	row := &FileHash{}
	var observedMTime sql.NullString
	err := conn.QueryRow(`
		SELECT remote_name, rel_path, side, algorithm, hash_value, observed_mtime, observed_size, computed_at
		FROM file_hash
		WHERE remote_name = ? AND rel_path = ? AND side = ?
		ORDER BY computed_at DESC
		LIMIT 1
	`, remoteName, relPath, side).Scan(
		&row.RemoteName, &row.RelPath, &row.Side, &row.Algorithm, &row.HashValue,
		&observedMTime, &row.ObservedSize, &row.ComputedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	row.ObservedMTime = observedMTime.String
	return row, nil
}
