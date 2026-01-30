package dropbox

type OAuthState struct {
	UserID    string `json:"u"`
	CSRFToken string `json:"c"`
}

type DropboxName struct {
	GivenName    string `json:"given_name"`
	Surname      string `json:"surname"`
	FamiliarName string `json:"familiar_name"`
	DisplayName  string `json:"display_name"`
}

type DropboxAccount struct {
	AccountID string      `json:"account_id"`
	Name      DropboxName `json:"name"`
	Email     string      `json:"email"`
}

type FileMetadata struct {
	Tag            string `json:".tag"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	PathLower      string `json:"path_lower"`
	PathDisplay    string `json:"path_display"`
	Size           int64  `json:"size"`
	ServerModified string `json:"server_modified"`
}

func (f *FileMetadata) IsFolder() bool {
	return f.Tag == "folder"
}

type ListFolderResult struct {
	Entries []FileMetadata `json:"entries"`
	Cursor  string         `json:"cursor"`
	HasMore bool           `json:"has_more"`
}

type SpaceAllocation struct {
	Tag       string `json:".tag"`
	Allocated int64  `json:"allocated"`
}

type SpaceUsage struct {
	Used       int64           `json:"used"`
	Allocation SpaceAllocation `json:"allocation"`
}

type UploadRequest struct {
	FolderPath string `json:"folder_path"`
	FileName   string `json:"file_name"`
	FileSize   int64  `json:"file_size"`
}

type UploadSessionResponse struct {
	SessionID string `json:"session_id"`
}
