package restic

import (
	"encoding/json"
	"strings"
)

// resticMessage is the discriminator wrapper restic uses on every --json line.
type resticMessage struct {
	MessageType string `json:"message_type"`
}

// resticStatusLine matches restic backup --json status events.
type resticStatusLine struct {
	PercentDone      float64  `json:"percent_done"`
	TotalFiles       int64    `json:"total_files"`
	FilesDone        int64    `json:"files_done"`
	TotalBytes       int64    `json:"total_bytes"`
	BytesDone        int64    `json:"bytes_done"`
	CurrentFiles     []string `json:"current_files"`
	SecondsElapsed   float64  `json:"seconds_elapsed"`
	SecondsRemaining float64  `json:"seconds_remaining"`
	ErrorCount       int      `json:"error_count"`
}

// resticSummaryLine matches the final summary event of `restic backup --json`.
type resticSummaryLine struct {
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

// resticErrorLine matches per-item error messages restic emits during backup.
type resticErrorLine struct {
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
	During string `json:"during"`
	Item   string `json:"item"`
}

// parseProgressLine parses one --json line from `restic backup` or `restic
// restore`. Returns:
//   - a normalized ProgressEvent (Type=="" means the line is informational and
//     should not be emitted to subscribers, e.g. verbose_status / initialized)
//   - a non-nil *BackupSummary only on the final summary line of a backup
//   - a parse error if the line is not valid JSON
func parseProgressLine(line []byte) (ProgressEvent, *BackupSummary, error) {
	var head resticMessage
	if err := json.Unmarshal(line, &head); err != nil {
		return ProgressEvent{}, nil, err
	}
	switch head.MessageType {
	case "status":
		var s resticStatusLine
		if err := json.Unmarshal(line, &s); err != nil {
			return ProgressEvent{}, nil, err
		}
		return ProgressEvent{
			Type:             "status",
			PercentDone:      s.PercentDone,
			TotalFiles:       s.TotalFiles,
			FilesProcessed:   s.FilesDone,
			TotalBytes:       s.TotalBytes,
			BytesProcessed:   s.BytesDone,
			CurrentFile:      strings.Join(s.CurrentFiles, ", "),
			SecondsElapsed:   s.SecondsElapsed,
			SecondsRemaining: s.SecondsRemaining,
		}, nil, nil
	case "summary":
		var s resticSummaryLine
		if err := json.Unmarshal(line, &s); err != nil {
			return ProgressEvent{}, nil, err
		}
		summary := &BackupSummary{
			SnapshotID:          s.SnapshotID,
			FilesNew:            s.FilesNew,
			FilesChanged:        s.FilesChanged,
			FilesUnmodified:     s.FilesUnmodified,
			DirsNew:             s.DirsNew,
			DirsChanged:         s.DirsChanged,
			DirsUnmodified:      s.DirsUnmodified,
			DataAdded:           s.DataAdded,
			TotalFilesProcessed: s.TotalFilesProcessed,
			TotalBytesProcessed: s.TotalBytesProcessed,
			TotalDuration:       s.TotalDuration,
		}
		return ProgressEvent{
			Type:           "summary",
			PercentDone:    1.0,
			FilesProcessed: s.TotalFilesProcessed,
			BytesProcessed: s.TotalBytesProcessed,
			SecondsElapsed: s.TotalDuration,
			SnapshotID:     s.SnapshotID,
		}, summary, nil
	case "error":
		var e resticErrorLine
		if err := json.Unmarshal(line, &e); err != nil {
			return ProgressEvent{}, nil, err
		}
		msg := e.Error.Message
		if e.Item != "" {
			msg = e.Item + ": " + msg
		}
		return ProgressEvent{Type: "error", ErrorMessage: msg}, nil, nil
	default:
		// verbose_status, initialized, exit_error, etc. — ignored.
		return ProgressEvent{}, nil, nil
	}
}
