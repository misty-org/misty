package remote

type providerConfigRequest struct {
	Name       string            `json:"name"`
	Type       string            `json:"type"`
	Parameters map[string]string `json:"parameters"`
	State      string            `json:"state"`
	Result     string            `json:"result"`
}

type listFilesRequest struct {
	Remote string `json:"remote"`
	Path   string `json:"path"`
}

type downloadFileRequest struct {
	Remote string `json:"remote"`
	Path   string `json:"path"`
}

type uploadFileRequest struct {
	Remote   string `json:"remote"`
	Path     string `json:"path"`
	FileName string `json:"file_name"`
}

type deleteFileRequest struct {
	Remote string `json:"remote"`
	Path   string `json:"path"`
}

type renameFileRequest struct {
	Remote  string `json:"remote"`
	OldPath string `json:"old_path"`
	NewPath string `json:"new_path"`
}
