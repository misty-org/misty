package syncindex

type DirectoryItem struct {
	Name          string `json:"name"`
	Path          string `json:"path"`       // remote-relative path
	LocalPath     string `json:"local_path"` // mounted local path
	IsDir         bool   `json:"is_dir"`
	Size          int64  `json:"size"`
	ModTime       string `json:"mod_time,omitempty"`
	MimeType      string `json:"mime_type,omitempty"`
	State         string `json:"state"`
	SyncDirty     bool   `json:"sync_dirty"`
	SyncDirection string `json:"sync_direction"`
	DirtyReason   string `json:"dirty_reason,omitempty"`
}

type DirectoryResponse struct {
	Items    []DirectoryItem `json:"items"`
	Remote   string          `json:"remote"`
	Path     string          `json:"path"`
	DirtyBit bool            `json:"dirty_bit"`
	Watched  bool            `json:"watched"`
}

type DirectoryStreamChunk struct {
	Type     string          `json:"type"`
	Remote   string          `json:"remote,omitempty"`
	Path     string          `json:"path,omitempty"`
	Items    []DirectoryItem `json:"items,omitempty"`
	DirtyBit bool            `json:"dirty_bit,omitempty"`
	Watched  bool            `json:"watched,omitempty"`
	Error    string          `json:"error,omitempty"`
}
