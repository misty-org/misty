package ms

type OAuthLoginResponse struct {
	AuthURL string `json:"auth_url"`
}

type OAuthState struct {
	UserID    string `json:"u"`
	CSRFToken string `json:"c"`
}


type DriveResponse struct {
	ODataContext string `json:"@odata.context,omitempty"`
	Drive
}

type DriveItemsResponse struct {
	ODataContext  string      `json:"@odata.context,omitempty"`
	ODataNextLink string      `json:"@odata.nextLink,omitempty"`
	Value         []DriveItem `json:"value"`
}

type UploadRequest struct {
	DriveID string `json:"drive_id"`
	ParentID string `json:"parent_id"`
	FileName string `json:"file_name"`
	FileSize int64 `json:"file_size"`
}

type UploadSession struct {
	UploadURL          string   `json:"uploadUrl"`
	ExpirationDateTime string   `json:"expirationDateTime"`
	NextExpectedRanges []string `json:"nextExpectedRanges,omitempty"`
}

// === Core Types ===

type Drive struct {
	ID                   string      `json:"id"`
	Name                 string      `json:"name"`
	Description          string      `json:"description,omitempty"`
	DriveType            string      `json:"driveType"`
	WebURL               string      `json:"webUrl"`
	CreatedDateTime      string      `json:"createdDateTime"`
	LastModifiedDateTime string      `json:"lastModifiedDateTime"`
	CreatedBy            IdentitySet `json:"createdBy,omitempty"`
	LastModifiedBy       IdentitySet `json:"lastModifiedBy,omitempty"`
	Owner                IdentitySet `json:"owner,omitempty"`
	Quota                *DriveQuota `json:"quota,omitempty"`
}

type DriveItem struct {
	ID                   string          `json:"id"`
	Name                 string          `json:"name"`
	Size                 int64           `json:"size"`
	WebURL               string          `json:"webUrl,omitempty"`
	DownloadURL          string          `json:"@microsoft.graph.downloadUrl,omitempty"`
	CreatedDateTime      string          `json:"createdDateTime"`
	LastModifiedDateTime string          `json:"lastModifiedDateTime"`
	ETag                 string          `json:"eTag,omitempty"`
	CTag                 string          `json:"cTag,omitempty"`
	CreatedBy            *IdentitySet    `json:"createdBy,omitempty"`
	LastModifiedBy       *IdentitySet    `json:"lastModifiedBy,omitempty"`
	ParentReference      *ItemReference  `json:"parentReference,omitempty"`
	FileSystemInfo       *FileSystemInfo `json:"fileSystemInfo,omitempty"`

	// Type-specific (only one present)
	File          *FileInfo      `json:"file,omitempty"`
	Folder        *FolderInfo    `json:"folder,omitempty"`
	Image         *ImageInfo     `json:"image,omitempty"`
	Photo         *PhotoInfo     `json:"photo,omitempty"`
	RemoteItem    *RemoteItem    `json:"remoteItem,omitempty"`
	SpecialFolder *SpecialFolder `json:"specialFolder,omitempty"`
}

func (d *DriveItem) IsFolder() bool { return d.Folder != nil }
func (d *DriveItem) IsFile() bool   { return d.File != nil }

// === Identity ===

type IdentitySet struct {
	User        *Identity `json:"user,omitempty"`
	Application *Identity `json:"application,omitempty"`
}

type Identity struct {
	ID          string `json:"id,omitempty"`
	Email       string `json:"email,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
}

// === References ===

type ItemReference struct {
	DriveID   string `json:"driveId,omitempty"`
	DriveType string `json:"driveType,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Path      string `json:"path,omitempty"`
	SiteID    string `json:"siteId,omitempty"`
}

type FileSystemInfo struct {
	CreatedDateTime      string `json:"createdDateTime,omitempty"`
	LastModifiedDateTime string `json:"lastModifiedDateTime,omitempty"`
}

// === File/Folder Info ===

type FileInfo struct {
	MimeType string    `json:"mimeType,omitempty"`
	Hashes   *HashInfo `json:"hashes,omitempty"`
}

type HashInfo struct {
	QuickXorHash string `json:"quickXorHash,omitempty"`
	SHA1Hash     string `json:"sha1Hash,omitempty"`
	SHA256Hash   string `json:"sha256Hash,omitempty"`
}

type FolderInfo struct {
	ChildCount int         `json:"childCount"`
	View       *FolderView `json:"view,omitempty"`
}

type FolderView struct {
	SortBy    string `json:"sortBy,omitempty"`
	SortOrder string `json:"sortOrder,omitempty"`
	ViewType  string `json:"viewType,omitempty"`
}

// === Media Info ===

type ImageInfo struct {
	Height int `json:"height,omitempty"`
	Width  int `json:"width,omitempty"`
}

type PhotoInfo struct {
	TakenDateTime string `json:"takenDateTime,omitempty"`
	CameraMake    string `json:"cameraMake,omitempty"`
	CameraModel   string `json:"cameraModel,omitempty"`
}

// === Special Types ===

type SpecialFolder struct {
	Name string `json:"name"`
}

type RemoteItem struct {
	ID              string         `json:"id"`
	Size            int64          `json:"size"`
	Folder          *FolderInfo    `json:"folder,omitempty"`
	File            *FileInfo      `json:"file,omitempty"`
	ParentReference *ItemReference `json:"parentReference,omitempty"`
	SharepointIDs   *SharepointIDs `json:"sharepointIds,omitempty"`
}

type SharepointIDs struct {
	ListID           string `json:"listId,omitempty"`
	ListItemUniqueID string `json:"listItemUniqueId,omitempty"`
	SiteID           string `json:"siteId,omitempty"`
	SiteURL          string `json:"siteUrl,omitempty"`
	WebID            string `json:"webId,omitempty"`
}

// === Quota ===

type DriveQuota struct {
	Total                  int64            `json:"total"`
	Used                   int64            `json:"used"`
	Remaining              int64            `json:"remaining"`
	Deleted                int64            `json:"deleted"`
	State                  string           `json:"state"`
	StoragePlanInformation *StoragePlanInfo `json:"storagePlanInformation,omitempty"`
}

type StoragePlanInfo struct {
	UpgradeAvailable bool `json:"upgradeAvailable"`
}

// === Error Response ===

type GraphError struct {
	Error *GraphErrorDetail `json:"error,omitempty"`
}

type GraphErrorDetail struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	InnerError *struct {
		RequestID string `json:"request-id,omitempty"`
		Date      string `json:"date,omitempty"`
	} `json:"innerError,omitempty"`
}

func (e *GraphError) String() string {
	if e.Error != nil {
		return e.Error.Code + ": " + e.Error.Message
	}
	return "unknown error"
}