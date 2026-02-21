package gd

type GoogleUserProfile struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	VerifiedEmail bool   `json:"verified_email"`
}

type OAuthState struct {
	UserID    string `json:"u"`
	CSRFToken string `json:"c"`
}

// === Google Drive API Types ===

type GDriveFile struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	MimeType         string   `json:"mimeType"`
	Size             string   `json:"size,omitempty"`
	WebViewLink      string   `json:"webViewLink,omitempty"`
	CreatedTime      string   `json:"createdTime,omitempty"`
	ModifiedTime     string   `json:"modifiedTime,omitempty"`
	Parents          []string `json:"parents,omitempty"`
	IconLink         string   `json:"iconLink,omitempty"`
	ThumbnailLink    string   `json:"thumbnailLink,omitempty"`
}

func (f *GDriveFile) IsFolder() bool {
	return f.MimeType == "application/vnd.google-apps.folder"
}

type GDriveFileList struct {
	Files         []GDriveFile `json:"files"`
	NextPageToken string       `json:"nextPageToken,omitempty"`
}

type GDriveAbout struct {
	User         *GDriveUser         `json:"user,omitempty"`
	StorageQuota *GDriveStorageQuota `json:"storageQuota,omitempty"`
}

type GDriveUser struct {
	DisplayName  string `json:"displayName"`
	EmailAddress string `json:"emailAddress"`
	PhotoLink    string `json:"photoLink,omitempty"`
}

type GDriveStorageQuota struct {
	Limit        string `json:"limit,omitempty"`
	Usage        string `json:"usage,omitempty"`
	UsageInDrive string `json:"usageInDrive,omitempty"`
	UsageInTrash string `json:"usageInTrash,omitempty"`
}

type UploadRequest struct {
	ParentID string `json:"parent_id"`
	FileName string `json:"file_name"`
	FileSize int64  `json:"file_size"`
}

type UploadSessionResponse struct {
	UploadURL string `json:"uploadUrl"`
}