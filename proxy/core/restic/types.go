package restic

import "time"

// RepoConfig identifies a restic repository tracked by misty. The password is
// never stored here — production lookups go through the OS keyring (see
// password.go); for now the dev fallback is a 0600 file under the registry dir
// keyed by Name.
type RepoConfig struct {
	Name       string    `json:"name"`
	URL        string    `json:"url"`         // local:/path, rclone:remote:path, s3:..., etc.
	KeyringRef string    `json:"keyring_ref"` // OS keyring entry; never the password itself
	CreatedAt  time.Time `json:"created_at"`
}

// Snapshot is a parsed entry from `restic snapshots --json`.
type Snapshot struct {
	ID             string    `json:"id"`
	ShortID        string    `json:"short_id"`
	Time           time.Time `json:"time"`
	Hostname       string    `json:"hostname"`
	Username       string    `json:"username"`
	Paths          []string  `json:"paths"`
	Tags           []string  `json:"tags,omitempty"`
	Parent         string    `json:"parent,omitempty"`
	Tree           string    `json:"tree,omitempty"`
	ProgramVersion string    `json:"program_version,omitempty"`
}

// FileNode is a single entry in `restic ls --json <snapshot> <path>`.
type FileNode struct {
	Name  string    `json:"name"`
	Type  string    `json:"type"` // "file" | "dir" | "symlink"
	Path  string    `json:"path"`
	UID   uint32    `json:"uid,omitempty"`
	GID   uint32    `json:"gid,omitempty"`
	Size  uint64    `json:"size,omitempty"`
	Mode  uint32    `json:"mode,omitempty"`
	MTime time.Time `json:"mtime,omitempty"`
}

// ProgressEvent is the normalized form of restic's --json status/summary lines
// during long-running operations (backup, restore, prune, check).
type ProgressEvent struct {
	Type             string  `json:"type"` // "status" | "summary" | "error"
	PercentDone      float64 `json:"percent_done"`
	TotalFiles       int64   `json:"total_files"`
	FilesProcessed   int64   `json:"files_processed"`
	TotalBytes       int64   `json:"total_bytes"`
	BytesProcessed   int64   `json:"bytes_processed"`
	CurrentFile      string  `json:"current_file,omitempty"`
	SecondsElapsed   float64 `json:"seconds_elapsed"`
	SecondsRemaining float64 `json:"seconds_remaining,omitempty"`
	ErrorMessage     string  `json:"error_message,omitempty"`
	SnapshotID       string  `json:"snapshot_id,omitempty"` // only set on summary events
}

// BackupSummary mirrors the message_type=summary line restic emits at the end
// of a backup operation.
type BackupSummary struct {
	SnapshotID          string  `json:"snapshot_id"`
	FilesNew            int64   `json:"files_new"`
	FilesChanged        int64   `json:"files_changed"`
	FilesUnmodified     int64   `json:"files_unmodified"`
	DirsNew             int64   `json:"dirs_new"`
	DirsChanged         int64   `json:"dirs_changed"`
	DirsUnmodified      int64   `json:"dirs_unmodified"`
	DataAdded           int64   `json:"data_added"`
	TotalFilesProcessed int64   `json:"total_files_processed"`
	TotalBytesProcessed int64   `json:"total_bytes_processed"`
	TotalDuration       float64 `json:"total_duration"`
}

// RetentionPolicy maps to `restic forget --keep-*` flags.
type RetentionPolicy struct {
	KeepLast    int `json:"keep_last,omitempty"`
	KeepHourly  int `json:"keep_hourly,omitempty"`
	KeepDaily   int `json:"keep_daily,omitempty"`
	KeepWeekly  int `json:"keep_weekly,omitempty"`
	KeepMonthly int `json:"keep_monthly,omitempty"`
	KeepYearly  int `json:"keep_yearly,omitempty"`
}

// RepoStatsResult is the parsed output of `restic stats --json --mode raw-data`.
type RepoStatsResult struct {
	TotalSize      int64 `json:"total_size"`
	TotalFileCount int64 `json:"total_file_count"`
	TotalBlobCount int64 `json:"total_blob_count,omitempty"`
	SnapshotsCount int64 `json:"snapshots_count,omitempty"`
}
