package rclone

import "time"

type RemoteInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

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

type ListResponse struct {
	Items  []FileItem `json:"items"`
	Remote string     `json:"remote"`
	Path   string     `json:"path"`
}

type AboutInfo struct {
	Remote  string `json:"remote"`
	Total   int64  `json:"total"`
	Used    int64  `json:"used"`
	Free    int64  `json:"free"`
	Trashed int64  `json:"trashed,omitempty"`
}
