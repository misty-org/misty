package api

import (
	"archive/zip"
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
	"github.com/kannachi323/misty/server/security"
)

const (
	libraryUploadTokenHeader      = "X-Misty-Library-Upload-Token"
	libraryReauthenticationHeader = "X-Misty-Library-Reauthentication"
	libraryUploadLifetime         = 30 * time.Minute
)

var librarySHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type SpaceLibraryService struct {
	database           *db.Database
	store              LibraryObjectStore
	uploadsEnabled     bool
	attachmentsEnabled bool
	groupsEnabled      bool
	previewsEnabled    bool
	peopleEnabled      bool
	peopleProcessor    LibraryPeopleProcessor
	intelligence       *serveragent.SmartLibraryAnalyzer
	ocrEnabled         bool
	aiEnabled          bool
	editingEnabled     bool
	mediaProcessor     LibraryMediaProcessor
	metadataExtractor  LibraryMetadataExtractor
	locationsEnabled   bool
	duplicatesEnabled  bool
	importsEnabled     bool
	exportsEnabled     bool
	malwareScanner     LibraryMalwareScanner
	maxFileBytes       int64
}

func (s *SpaceLibraryService) SetSubsystems(attachmentsEnabled, groupsEnabled, previewsEnabled, peopleEnabled, editingEnabled, locationsEnabled, duplicatesEnabled, importsEnabled, exportsEnabled bool) {
	s.attachmentsEnabled = attachmentsEnabled
	s.groupsEnabled = groupsEnabled
	s.previewsEnabled = previewsEnabled
	s.peopleEnabled = peopleEnabled
	s.editingEnabled = editingEnabled
	s.locationsEnabled = locationsEnabled
	s.duplicatesEnabled = duplicatesEnabled
	s.importsEnabled = importsEnabled
	s.exportsEnabled = exportsEnabled
}

func (s *SpaceLibraryService) SetMalwareScanner(scanner LibraryMalwareScanner) {
	s.malwareScanner = scanner
}

func (s *SpaceLibraryService) SetIntelligence(analyzer *serveragent.SmartLibraryAnalyzer, ocrEnabled, aiEnabled bool) {
	s.intelligence = analyzer
	s.ocrEnabled = ocrEnabled
	s.aiEnabled = aiEnabled
}

func (s *SpaceLibraryService) SetMetadataExtractor(extractor LibraryMetadataExtractor) {
	s.metadataExtractor = extractor
}

func (s *SpaceLibraryService) uploadPurposeEnabled(purpose string) bool {
	return purpose == "library" && s.uploadsEnabled || purpose == "attachment" && s.attachmentsEnabled
}

func NewSpaceLibraryService(database *db.Database, store LibraryObjectStore, uploadsEnabled bool, maxFileBytes int64) (*SpaceLibraryService, error) {
	if database == nil || store == nil {
		return nil, errors.New("Library database and permanent object store are required")
	}
	if maxFileBytes < 1 || maxFileBytes > db.MaxSpaceStorageBytes {
		return nil, errors.New("Library max file bytes must be between 1 and 1,000,000,000")
	}
	return &SpaceLibraryService{database: database, store: store, uploadsEnabled: uploadsEnabled, maxFileBytes: maxFileBytes}, nil
}

func (s *SpaceLibraryService) Items() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if r.Method == http.MethodGet {
			queryValues := r.URL.Query()
			sensitiveScope := ""
			if queryValues.Get("visibility") == "hidden" {
				sensitiveScope = "hidden"
			} else if queryValues.Get("collection") == "recently-deleted" {
				sensitiveScope = "recently_deleted"
			}
			if sensitiveScope != "" {
				if err := s.validateLibraryReauthentication(r, userID, spaceID, sensitiveScope); err != nil {
					writeLibraryError(w, err)
					return
				}
			}
			limit, _ := strconv.Atoi(queryValues.Get("limit"))
			if limit < 1 || limit > 200 {
				limit = 100
			}
			query := db.LibraryItemQuery{
				After:      queryValues.Get("after"),
				Limit:      limit,
				Collection: queryValues.Get("collection"),
				Search:     queryValues.Get("q"),
				Sort:       queryValues.Get("sort"),
				Direction:  queryValues.Get("direction"),
				MediaType:  queryValues.Get("media_type"),
				Utility:    queryValues.Get("utility"),
				Visibility: queryValues.Get("visibility"),
				AlbumID:    queryValues.Get("album_id"),
				Favorite:   queryValues.Get("favorite") == "true",
			}
			for value, target := range map[string]**time.Time{
				queryValues.Get("date_from"): &query.DateFrom,
				queryValues.Get("date_to"):   &query.DateTo,
			} {
				if value == "" {
					continue
				}
				parsed, parseErr := time.Parse(time.RFC3339, value)
				if parseErr != nil {
					writeLibraryError(w, db.ErrLibraryInvalid)
					return
				}
				*target = &parsed
			}
			items, err := s.database.LibraryItems(r.Context(), userID, spaceID, query)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			nextAfter := ""
			if len(items) == query.Limit {
				nextAfter = items[len(items)-1].ID
			}
			writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_after": nextAfter})
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *SpaceLibraryService) Reauthenticate() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Password string `json:"password"`
			Scope    string `json:"scope"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		valid, err := s.database.VerifyUserPassword(r.Context(), userID, body.Password)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		if !valid {
			_ = s.database.RecordLibraryReauthenticationDenied(r.Context(), userID, chi.URLParam(r, "spaceID"), body.Scope)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "reauthentication_failed"})
			return
		}
		token, err := security.GenerateSecureToken()
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		expiresAt, err := s.database.CreateLibraryReauthenticationGrant(r.Context(), userID, chi.URLParam(r, "spaceID"), body.Scope, security.HashToken(token), 5*time.Minute)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"token": token, "scope": body.Scope, "expires_at": expiresAt})
	}
}

func (s *SpaceLibraryService) Facets() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		facets, err := s.database.LibraryFacets(r.Context(), userID, chi.URLParam(r, "spaceID"), r.URL.Query().Get("q"))
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, facets)
	}
}

func (s *SpaceLibraryService) Discovery() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		discovery, err := s.database.LibraryDiscovery(r.Context(), userID, chi.URLParam(r, "spaceID"))
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		if !s.locationsEnabled {
			discovery.Trips = []db.LibraryDiscoveryGroup{}
			discovery.MapPoints = []db.LibraryMapPoint{}
		}
		if !s.duplicatesEnabled {
			discovery.Duplicates = []db.LibraryDiscoveryGroup{}
		}
		writeJSON(w, http.StatusOK, discovery)
	}
}

func (s *SpaceLibraryService) DiscoveryItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		kind := chi.URLParam(r, "kind")
		if (kind == "trip" || kind == "map") && !s.locationsEnabled || kind == "duplicate" && !s.duplicatesEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_discovery_disabled"})
			return
		}
		items, err := s.database.LibraryDiscoveryItems(r.Context(), userID, chi.URLParam(r, "spaceID"), kind, chi.URLParam(r, "groupID"))
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func (s *SpaceLibraryService) MemoryPreference() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Version         int64   `json:"version"`
			Title           string  `json:"title"`
			CoverItemID     string  `json:"cover_item_id"`
			MusicItemID     string  `json:"music_item_id"`
			PlaybackSeconds float64 `json:"playback_seconds"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		spaceID, memoryID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "memoryID")
		if err := s.database.UpdateLibraryMemoryPreference(r.Context(), userID, spaceID, memoryID, body.Version, body.Title, body.CoverItemID, body.MusicItemID, body.PlaybackSeconds); err != nil {
			writeLibraryError(w, err)
			return
		}
		discovery, err := s.database.LibraryDiscovery(r.Context(), userID, spaceID)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		for _, memory := range discovery.Memories {
			if memory.ID == memoryID {
				writeJSON(w, http.StatusOK, memory)
				return
			}
		}
		writeLibraryError(w, db.ErrLibraryNotFound)
	}
}

func (s *SpaceLibraryService) MergeDuplicates() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if !s.duplicatesEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_duplicates_disabled"})
			return
		}
		var body struct {
			Keeper     db.LibraryItemVersion   `json:"keeper"`
			Duplicates []db.LibraryItemVersion `json:"duplicates"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if err := s.validateSensitiveLibraryItem(r, userID, spaceID, body.Keeper.ID); err != nil {
			writeLibraryError(w, err)
			return
		}
		for _, duplicate := range body.Duplicates {
			if err := s.validateSensitiveLibraryItem(r, userID, spaceID, duplicate.ID); err != nil {
				writeLibraryError(w, err)
				return
			}
		}
		item, err := s.database.MergeLibraryDuplicates(r.Context(), userID, spaceID, body.Keeper, body.Duplicates)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	}
}

func (s *SpaceLibraryService) ExportItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if !s.exportsEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_exports_disabled"})
			return
		}
		var body struct {
			ItemIDs []string `json:"item_ids"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if err := s.validateLibraryReauthentication(r, userID, spaceID, "bulk_export"); err != nil {
			writeLibraryError(w, err)
			return
		}
		items, err := s.database.LibraryTransferItems(r.Context(), userID, spaceID, body.ItemIDs)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		var total int64
		for _, item := range items {
			total += item.ByteSize
			metadata, headErr := s.store.Head(r.Context(), item.ObjectKey)
			if headErr != nil || metadata.ByteSize != item.ByteSize || metadata.SHA256 != item.SHA256 {
				writeJSON(w, http.StatusConflict, map[string]string{"code": "library_object_mismatch"})
				return
			}
		}
		if total > 500_000_000 {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"code": "library_export_too_large"})
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "misty-library-export-" + time.Now().Format("20060102") + ".zip"}))
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		archive := zip.NewWriter(w)
		usedNames := map[string]int{}
		for _, item := range items {
			reader, _, openErr := s.store.Open(r.Context(), item.ObjectKey)
			if openErr != nil {
				_ = archive.Close()
				return
			}
			filename := item.Filename
			if item.Rendition {
				filename = libraryRenditionFilename(filename, item.MIMEType)
			}
			name := uniqueArchiveName(sanitizeLibraryFilename(filename), usedNames)
			entry, createErr := archive.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
			if createErr == nil {
				_, createErr = io.Copy(entry, io.LimitReader(reader, item.ByteSize+1))
			}
			_ = reader.Close()
			if createErr != nil {
				_ = archive.Close()
				return
			}
		}
		_ = archive.Close()
	}
}

func (s *SpaceLibraryService) ImportItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if !s.importsEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_imports_disabled"})
			return
		}
		var body struct {
			DestinationSpaceID string   `json:"destination_space_id"`
			ItemIDs            []string `json:"item_ids"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		sourceSpaceID := chi.URLParam(r, "spaceID")
		if body.DestinationSpaceID == "" || body.DestinationSpaceID == sourceSpaceID || len(body.ItemIDs) < 1 || len(body.ItemIDs) > 50 {
			writeLibraryError(w, db.ErrLibraryInvalid)
			return
		}
		allowed, err := s.database.HasSpacePermission(r.Context(), userID, body.DestinationSpaceID, db.PermissionLibraryImport)
		if err != nil || !allowed {
			writeLibraryError(w, db.ErrLibraryForbidden)
			return
		}
		items, err := s.database.LibraryTransferItems(r.Context(), userID, sourceSpaceID, body.ItemIDs)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		for _, itemID := range body.ItemIDs {
			if err := s.validateSensitiveLibraryItem(r, userID, sourceSpaceID, itemID); err != nil {
				writeLibraryError(w, err)
				return
			}
		}
		usage, err := s.database.SpaceStorageUsage(r.Context(), userID, body.DestinationSpaceID)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		var required int64
		for _, item := range items {
			required += item.ByteSize
		}
		if required > usage.RemainingBytes {
			writeLibraryError(w, db.ErrLibraryQuota)
			return
		}
		imported := make([]db.SpaceLibraryItem, 0, len(items))
		for _, item := range items {
			result, importErr := s.copyLibraryItem(r.Context(), userID, sourceSpaceID, body.DestinationSpaceID, item, true)
			if importErr != nil {
				writeLibraryError(w, importErr)
				return
			}
			imported = append(imported, *result)
		}
		writeJSON(w, http.StatusCreated, map[string]any{"items": imported})
	}
}

func (s *SpaceLibraryService) DuplicateItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			ItemIDs []string `json:"item_ids"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if len(body.ItemIDs) < 1 || len(body.ItemIDs) > 50 {
			writeLibraryError(w, db.ErrLibraryInvalid)
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		allowed, err := s.database.HasSpacePermission(r.Context(), userID, spaceID, db.PermissionLibraryEdit)
		if err != nil || !allowed {
			writeLibraryError(w, db.ErrLibraryForbidden)
			return
		}
		items, err := s.database.LibraryTransferItems(r.Context(), userID, spaceID, body.ItemIDs)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		for _, itemID := range body.ItemIDs {
			if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
				writeLibraryError(w, err)
				return
			}
		}
		usage, err := s.database.SpaceStorageUsage(r.Context(), userID, spaceID)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		var required int64
		for _, source := range items {
			required += source.ByteSize
		}
		if required > usage.RemainingBytes {
			writeLibraryError(w, db.ErrLibraryQuota)
			return
		}
		duplicated := make([]db.SpaceLibraryItem, 0, len(items))
		for _, source := range items {
			item, err := s.copyLibraryItem(r.Context(), userID, spaceID, spaceID, source, false)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			duplicated = append(duplicated, *item)
		}
		writeJSON(w, http.StatusCreated, map[string]any{"items": duplicated})
	}
}

func (s *SpaceLibraryService) SharedReferences() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if !s.importsEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_sharing_disabled"})
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			items, err := s.database.LibrarySharedReferences(r.Context(), userID, spaceID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			outgoing, _ := s.database.LibraryOutgoingGrants(r.Context(), userID, spaceID)
			writeJSON(w, http.StatusOK, map[string]any{"references": items, "outgoing": outgoing})
		case http.MethodPost:
			var body struct {
				DestinationSpaceID string   `json:"destination_space_id"`
				ItemIDs            []string `json:"item_ids"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			if len(body.ItemIDs) < 1 || len(body.ItemIDs) > 50 {
				writeLibraryError(w, db.ErrLibraryInvalid)
				return
			}
			items := make([]db.LibrarySharedReference, 0, len(body.ItemIDs))
			for _, itemID := range body.ItemIDs {
				if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
					writeLibraryError(w, err)
					return
				}
				item, err := s.database.CreateLibraryGrant(r.Context(), userID, spaceID, itemID, body.DestinationSpaceID)
				if err != nil {
					writeLibraryError(w, err)
					return
				}
				items = append(items, *item)
			}
			writeJSON(w, http.StatusCreated, map[string]any{"references": items})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) SharedReferenceDownload() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		download, err := s.database.LibrarySharedReferenceDownload(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "referenceID"))
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		s.writeDownload(w, r, download)
	}
}

func (s *SpaceLibraryService) RevokeGrant() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		version, err := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
		if err != nil {
			writeLibraryError(w, db.ErrLibraryInvalid)
			return
		}
		if err := s.database.RevokeLibraryGrant(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "grantID"), version); err != nil {
			writeLibraryError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpaceLibraryService) copyLibraryItem(ctx context.Context, userID, sourceSpaceID, destinationSpaceID string, source db.LibraryTransferItem, recordImport bool) (*db.SpaceLibraryItem, error) {
	token, err := security.GenerateSecureToken()
	if err != nil {
		return nil, err
	}
	tokenHash := security.HashToken(token)
	objectKey := "library/" + strings.ReplaceAll(uuid.NewString(), "-", "")
	filename := source.Filename
	if source.Rendition {
		filename = libraryRenditionFilename(filename, source.MIMEType)
	}
	upload, err := s.database.CreateLibraryUpload(ctx, userID, destinationSpaceID, "library", filename, source.MIMEType, source.ByteSize, source.SHA256, objectKey, tokenHash, time.Now().Add(libraryUploadLifetime).UTC())
	if err != nil {
		return nil, err
	}
	if _, err = s.database.SetLibraryUploadState(ctx, userID, destinationSpaceID, upload.ID, tokenHash, "initiated", "uploading"); err != nil {
		return nil, err
	}
	reader, _, err := s.store.Open(ctx, source.ObjectKey)
	if err != nil {
		s.rejectAndDelete(ctx, upload, tokenHash, "invalid", "import_source_missing")
		return nil, err
	}
	putErr := s.store.Put(ctx, objectKey, io.LimitReader(reader, source.ByteSize+1), LibraryObjectMetadata{ByteSize: source.ByteSize, SHA256: source.SHA256, MIMEType: source.MIMEType})
	_ = reader.Close()
	if putErr != nil {
		s.rejectAndDelete(ctx, upload, tokenHash, "invalid", "import_copy_failed")
		return nil, putErr
	}
	if _, err = s.database.SetLibraryUploadState(ctx, userID, destinationSpaceID, upload.ID, tokenHash, "uploading", "uploaded_unverified"); err != nil {
		s.rejectAndDelete(ctx, upload, tokenHash, "invalid", "import_state_failed")
		return nil, err
	}
	intrinsicMetadata := source.IntrinsicMetadata
	if source.Rendition {
		intrinsicMetadata = libraryRenditionIntrinsicMetadata(source)
	}
	completed, err := s.database.CompleteLibraryUpload(ctx, userID, destinationSpaceID, upload.ID, tokenHash, source.ByteSize, source.SHA256, source.MIMEType, intrinsicMetadata)
	if err != nil {
		s.rejectAndDelete(ctx, upload, tokenHash, "invalid", "import_finalize_failed")
		return nil, err
	}
	if completed.DiscardObjectKey != "" {
		_ = s.store.Delete(ctx, completed.DiscardObjectKey)
	}
	if completed.Item == nil {
		return nil, db.ErrLibraryConflict
	}
	if recordImport {
		if _, err := s.database.RecordLibraryImport(ctx, userID, sourceSpaceID, source.ItemID, destinationSpaceID, completed.Item.ID, upload.ID, source.ByteSize); err != nil {
			return nil, err
		}
	} else if err := s.database.RecordLibraryDuplicate(ctx, userID, destinationSpaceID, source.ItemID, completed.Item.ID, source.ByteSize); err != nil {
		return nil, err
	}
	return completed.Item, nil
}

func uniqueArchiveName(filename string, used map[string]int) string {
	if filename == "" {
		filename = "item"
	}
	count := used[strings.ToLower(filename)]
	used[strings.ToLower(filename)] = count + 1
	if count == 0 {
		return filename
	}
	extension := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, extension)
	return fmt.Sprintf("%s (%d)%s", base, count+1, extension)
}

func (s *SpaceLibraryService) Item() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, itemID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "itemID")
		if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
			writeLibraryError(w, err)
			return
		}
		switch r.Method {
		case http.MethodGet:
			item, err := s.database.LibraryItem(r.Context(), userID, spaceID, itemID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, item)
		case http.MethodPatch:
			var body struct {
				Version     int64    `json:"version"`
				DisplayName string   `json:"display_name"`
				Caption     string   `json:"caption"`
				Tags        []string `json:"tags"`
				Favorite    bool     `json:"favorite"`
				Hidden      bool     `json:"hidden"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			item, err := s.database.UpdateLibraryItem(r.Context(), userID, spaceID, itemID, body.Version, body.DisplayName, body.Caption, body.Tags, body.Favorite, body.Hidden)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, item)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) BulkItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Action           string                  `json:"action"`
			Items            []db.LibraryItemVersion `json:"items"`
			AlbumID          string                  `json:"album_id"`
			Tags             []string                `json:"tags"`
			DateOverride     string                  `json:"date_override"`
			LocationOverride json.RawMessage         `json:"location_override"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		for _, item := range body.Items {
			if err := s.validateSensitiveLibraryItem(r, userID, spaceID, item.ID); err != nil {
				writeLibraryError(w, err)
				return
			}
		}
		if body.Action == "restore" {
			if err := s.validateLibraryReauthentication(r, userID, spaceID, "recently_deleted"); err != nil {
				writeLibraryError(w, err)
				return
			}
		}
		operation := db.BulkLibraryItemOperation{Action: body.Action, Items: body.Items, AlbumID: body.AlbumID, Tags: body.Tags, LocationOverride: body.LocationOverride}
		if body.DateOverride != "" {
			parsed, err := time.Parse(time.RFC3339, body.DateOverride)
			if err != nil {
				writeLibraryError(w, db.ErrLibraryInvalid)
				return
			}
			operation.DateOverride = &parsed
		}
		items, err := s.database.BulkUpdateLibraryItems(r.Context(), userID, spaceID, operation)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func (s *SpaceLibraryService) TrashItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, itemID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "itemID")
		if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
			writeLibraryError(w, err)
			return
		}
		item, err := s.database.TrashLibraryItem(r.Context(), userID, spaceID, itemID)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	}
}

func (s *SpaceLibraryService) RestoreItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, itemID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "itemID")
		if err := s.validateLibraryReauthentication(r, userID, spaceID, "recently_deleted"); err != nil {
			writeLibraryError(w, err)
			return
		}
		item, err := s.database.RestoreLibraryItem(r.Context(), userID, spaceID, itemID)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	}
}

func (s *SpaceLibraryService) CleanupExpired(ctx context.Context, limit int) (int, error) {
	uploads, err := s.database.ExpireLibraryUploads(ctx, limit)
	if err != nil {
		return 0, err
	}
	for _, upload := range uploads {
		if err := s.store.Delete(ctx, upload.ObjectKey); err != nil && !errors.Is(err, ErrLibraryObjectNotFound) {
			return len(uploads), err
		}
	}
	_, err = s.database.ReconcileLibraryStorageUsage(ctx, limit)
	return len(uploads), err
}

func (s *SpaceLibraryService) Usage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		usage, err := s.database.SpaceStorageUsage(r.Context(), userID, chi.URLParam(r, "spaceID"))
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, usage)
	}
}

func (s *SpaceLibraryService) AssetStacks() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if r.Method == http.MethodGet {
			stacks, err := s.database.LibraryAssetStacks(r.Context(), userID, spaceID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"stacks": stacks})
			return
		}
		var input db.CreateLibraryAssetStack
		if decodeJSON(w, r, &input) != nil {
			return
		}
		for _, member := range input.Members {
			if err := s.validateSensitiveLibraryItem(r, userID, spaceID, member.ItemID); err != nil {
				writeLibraryError(w, err)
				return
			}
		}
		stack, err := s.database.CreateLibraryAssetStack(r.Context(), userID, spaceID, input)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, stack)
	}
}

func (s *SpaceLibraryService) AssetStack() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, stackID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "stackID")
		if err := s.validateSensitiveLibraryAssetStack(r, userID, spaceID, stackID); err != nil {
			writeLibraryError(w, err)
			return
		}
		if r.Method == http.MethodPatch {
			var input struct {
				Version     int64  `json:"version"`
				Title       string `json:"title"`
				CoverItemID string `json:"cover_item_id"`
				Effect      string `json:"effect"`
			}
			if decodeJSON(w, r, &input) != nil {
				return
			}
			stack, err := s.database.UpdateLibraryAssetStack(r.Context(), userID, spaceID, stackID, input.Version, input.Title, input.CoverItemID, input.Effect)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, stack)
			return
		}
		version, err := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
		if err != nil {
			writeLibraryError(w, db.ErrLibraryInvalid)
			return
		}
		if err := s.database.DeleteLibraryAssetStack(r.Context(), userID, spaceID, stackID, version); err != nil {
			writeLibraryError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpaceLibraryService) InitiateUpload() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Filename string `json:"filename"`
			MIMEType string `json:"mime_type"`
			ByteSize int64  `json:"byte_size"`
			SHA256   string `json:"sha256"`
			Purpose  string `json:"purpose"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if !s.uploadPurposeEnabled(body.Purpose) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_uploads_disabled"})
			return
		}
		body.Filename = sanitizeLibraryFilename(body.Filename)
		body.SHA256 = strings.ToLower(strings.TrimSpace(body.SHA256))
		body.MIMEType = strings.TrimSpace(body.MIMEType)
		if body.ByteSize < 1 || body.ByteSize > s.maxFileBytes || !librarySHA256Pattern.MatchString(body.SHA256) || body.Filename == "" || (body.Purpose != "library" && body.Purpose != "attachment") {
			writeLibraryError(w, db.ErrLibraryInvalid)
			return
		}
		token, err := security.GenerateSecureToken()
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		objectKey := "library/" + strings.ReplaceAll(uuid.NewString(), "-", "")
		expiresAt := time.Now().Add(libraryUploadLifetime).UTC()
		upload, err := s.database.CreateLibraryUpload(r.Context(), userID, chi.URLParam(r, "spaceID"), body.Purpose, body.Filename, body.MIMEType, body.ByteSize, body.SHA256, objectKey, security.HashToken(token), expiresAt)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		transfer := LibraryObjectUpload{
			URL: fmt.Sprintf("/spaces/%s/library/uploads/%s/content", upload.SpaceID, upload.ID), Method: http.MethodPut,
			Headers: map[string]string{libraryUploadTokenHeader: token, "Content-Type": body.MIMEType}, ExpiresAt: expiresAt,
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"upload":   upload,
			"transfer": transfer,
			"finalize": map[string]any{"headers": map[string]string{libraryUploadTokenHeader: token}},
		})
	}
}

func (s *SpaceLibraryService) UploadContent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, uploadID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "uploadID")
		tokenHash := security.HashToken(strings.TrimSpace(r.Header.Get(libraryUploadTokenHeader)))
		pending, err := s.database.LibraryUpload(r.Context(), userID, spaceID, uploadID)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		if !s.uploadPurposeEnabled(pending.Purpose) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_uploads_disabled"})
			return
		}
		upload, err := s.database.SetLibraryUploadState(r.Context(), userID, spaceID, uploadID, tokenHash, "initiated", "uploading")
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		if r.ContentLength != upload.RequestedByteSize {
			s.rejectAndDelete(r.Context(), upload, tokenHash, "invalid", "content_length_mismatch")
			writeLibraryError(w, db.ErrLibraryUploadMismatch)
			return
		}
		metadata := LibraryObjectMetadata{ByteSize: upload.RequestedByteSize, SHA256: upload.ClientSHA256, MIMEType: upload.ClientDeclaredMIMEType}
		if err := s.store.Put(r.Context(), upload.ObjectKey, io.LimitReader(r.Body, upload.RequestedByteSize+1), metadata); err != nil {
			s.rejectAndDelete(r.Context(), upload, tokenHash, "invalid", "object_write_failed")
			writeLibraryError(w, err)
			return
		}
		upload, err = s.database.SetLibraryUploadState(r.Context(), userID, spaceID, uploadID, tokenHash, "uploading", "uploaded_unverified")
		if err != nil {
			_ = s.store.Delete(r.Context(), upload.ObjectKey)
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, upload)
	}
}

func (s *SpaceLibraryService) FinalizeUpload() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, uploadID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "uploadID")
		tokenHash := security.HashToken(strings.TrimSpace(r.Header.Get(libraryUploadTokenHeader)))
		upload, err := s.database.LibraryUpload(r.Context(), userID, spaceID, uploadID)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		if !s.uploadPurposeEnabled(upload.Purpose) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_uploads_disabled"})
			return
		}
		if upload.UploadTokenHash != tokenHash {
			writeLibraryError(w, db.ErrLibraryForbidden)
			return
		}
		if upload.State == "ready" {
			result, err := s.database.CompleteLibraryUpload(r.Context(), userID, spaceID, uploadID, tokenHash, upload.RequestedByteSize, upload.ClientSHA256, upload.DetectedMIMEType, nil)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, result)
			return
		}
		if upload.State != "uploaded_unverified" {
			writeLibraryError(w, db.ErrLibraryConflict)
			return
		}

		// Bytes reach R2 through UploadContent. Finalization verifies that the
		// server-side write produced the expected immutable object metadata.
		metadata, headErr := s.store.Head(r.Context(), upload.ObjectKey)
		if headErr != nil || metadata.ByteSize != upload.RequestedByteSize || metadata.SHA256 != upload.ClientSHA256 {
			s.rejectAndDelete(r.Context(), upload, tokenHash, "invalid", "object_missing_or_mismatched")
			writeLibraryError(w, db.ErrLibraryUploadMismatch)
			return
		}
		deduplicationKey, deduplicationErr := s.database.LibraryUploadDeduplicationObjectKey(r.Context(), userID, spaceID, uploadID)
		if deduplicationErr != nil {
			writeLibraryError(w, deduplicationErr)
			return
		}
		if deduplicationKey != "" {
			if _, existingErr := s.store.Head(r.Context(), deduplicationKey); errors.Is(existingErr, ErrLibraryObjectNotFound) {
				if repairErr := s.database.ReplaceMissingLibraryUploadDeduplicationObject(r.Context(), userID, spaceID, uploadID, deduplicationKey); repairErr != nil {
					writeLibraryError(w, repairErr)
					return
				}
			} else if existingErr != nil {
				writeLibraryError(w, existingErr)
				return
			}
		}
		intrinsic, _ := json.Marshal(map[string]any{
			"byte_size":                 metadata.ByteSize,
			"sha256":                    metadata.SHA256,
			"client_declared_mime_type": upload.ClientDeclaredMIMEType,
		})
		result, err := s.database.CompleteLibraryUpload(r.Context(), userID, spaceID, uploadID, tokenHash, metadata.ByteSize, metadata.SHA256, upload.ClientDeclaredMIMEType, intrinsic)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		if result.DiscardObjectKey != "" {
			_ = s.store.Delete(r.Context(), result.DiscardObjectKey)
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func (s *SpaceLibraryService) DownloadItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, itemID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "itemID")
		if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
			writeLibraryError(w, err)
			return
		}
		var download *db.LibraryDownload
		var err error
		if r.URL.Query().Get("version") == "original" {
			download, err = s.database.LibraryOriginalItemDownload(r.Context(), userID, spaceID, itemID)
		} else {
			download, err = s.database.LibraryItemDownload(r.Context(), userID, spaceID, itemID)
		}
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		s.writeDownload(w, r, download)
	}
}

func (s *SpaceLibraryService) PreviewItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.previewsEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_previews_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, itemID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "itemID")
		if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
			writeLibraryError(w, err)
			return
		}
		original := r.URL.Query().Get("version") == "original"
		source, err := s.database.LibraryItemPreviewSource(r.Context(), userID, spaceID, itemID, original)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		if source.PreviewObjectKey == "" && s.mediaProcessor == nil {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"code": "preview_unavailable"})
			return
		}
		if source.PreviewObjectKey == "" {
			reader, metadata, openErr := s.store.Open(r.Context(), source.ObjectKey)
			if openErr != nil {
				writeLibraryError(w, openErr)
				return
			}
			if metadata.ByteSize != source.ByteSize || metadata.SHA256 != source.SHA256 {
				_ = reader.Close()
				writeJSON(w, http.StatusConflict, map[string]string{"code": "library_object_mismatch"})
				return
			}
			rendered, renderErr := s.mediaProcessor.Preview(r.Context(), reader, source.ByteSize, 2048)
			_ = reader.Close()
			if renderErr != nil {
				writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"code": "preview_unavailable"})
				return
			}
			defer rendered.Cleanup()
			previewReader, openRenderedErr := rendered.Open()
			if openRenderedErr != nil {
				writeLibraryError(w, openRenderedErr)
				return
			}
			objectKey := "library/" + strings.ReplaceAll(uuid.NewString(), "-", "")
			putErr := s.store.Put(r.Context(), objectKey, previewReader, LibraryObjectMetadata{ByteSize: rendered.ByteSize, SHA256: rendered.SHA256, MIMEType: rendered.MIMEType})
			_ = previewReader.Close()
			if putErr != nil {
				writeLibraryError(w, putErr)
				return
			}
			completed, completeErr := s.database.CompleteLibraryPreview(r.Context(), userID, spaceID, itemID, source.SourceIdentity, objectKey, rendered.MIMEType, rendered.ByteSize, rendered.SHA256, original)
			if completeErr != nil {
				_ = s.store.Delete(r.Context(), objectKey)
				writeLibraryError(w, completeErr)
				return
			}
			if completed.DiscardObjectKey != "" && completed.ObjectKey != objectKey {
				if _, existingErr := s.store.Head(r.Context(), completed.ObjectKey); errors.Is(existingErr, ErrLibraryObjectNotFound) {
					if completed.MIMEType != rendered.MIMEType || completed.ByteSize != rendered.ByteSize || completed.SHA256 != rendered.SHA256 {
						_ = s.store.Delete(r.Context(), objectKey)
						writeJSON(w, http.StatusConflict, map[string]string{"code": "library_preview_mismatch"})
						return
					}
					repairedKey, repairErr := s.database.ReplaceMissingLibraryPreviewDeduplicationObject(r.Context(), userID, spaceID, itemID, source.SourceIdentity, completed.ObjectKey, objectKey)
					if repairErr != nil {
						_ = s.store.Delete(r.Context(), objectKey)
						writeLibraryError(w, repairErr)
						return
					}
					completed.ObjectKey = repairedKey
					if repairedKey == objectKey {
						completed.DiscardObjectKey = ""
					}
				} else if existingErr != nil {
					_ = s.store.Delete(r.Context(), objectKey)
					writeLibraryError(w, existingErr)
					return
				}
			}
			if completed.DiscardObjectKey != "" {
				_ = s.store.Delete(r.Context(), completed.DiscardObjectKey)
			}
			source.PreviewObjectKey, source.PreviewMIME, source.PreviewBytes, source.PreviewSHA256 = completed.ObjectKey, completed.MIMEType, completed.ByteSize, completed.SHA256
		}
		if _, headErr := s.store.Head(r.Context(), source.PreviewObjectKey); errors.Is(headErr, ErrLibraryObjectNotFound) {
			if s.mediaProcessor == nil {
				writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"code": "preview_unavailable"})
				return
			}
			sourceReader, sourceMetadata, openSourceErr := s.store.Open(r.Context(), source.ObjectKey)
			if openSourceErr != nil {
				writeLibraryError(w, openSourceErr)
				return
			}
			if sourceMetadata.ByteSize != source.ByteSize || sourceMetadata.SHA256 != source.SHA256 {
				_ = sourceReader.Close()
				writeJSON(w, http.StatusConflict, map[string]string{"code": "library_object_mismatch"})
				return
			}
			rendered, renderErr := s.mediaProcessor.Preview(r.Context(), sourceReader, source.ByteSize, 2048)
			_ = sourceReader.Close()
			if renderErr != nil {
				writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"code": "preview_unavailable"})
				return
			}
			defer rendered.Cleanup()
			if source.PreviewMIME != rendered.MIMEType || source.PreviewBytes != rendered.ByteSize || source.PreviewSHA256 != rendered.SHA256 {
				writeJSON(w, http.StatusConflict, map[string]string{"code": "library_preview_mismatch"})
				return
			}
			previewReader, openRenderedErr := rendered.Open()
			if openRenderedErr != nil {
				writeLibraryError(w, openRenderedErr)
				return
			}
			replacementKey := "library/" + strings.ReplaceAll(uuid.NewString(), "-", "")
			putErr := s.store.Put(r.Context(), replacementKey, previewReader, LibraryObjectMetadata{ByteSize: rendered.ByteSize, SHA256: rendered.SHA256, MIMEType: rendered.MIMEType})
			_ = previewReader.Close()
			if putErr != nil {
				writeLibraryError(w, putErr)
				return
			}
			repairedKey, repairErr := s.database.ReplaceMissingLibraryPreviewDeduplicationObject(r.Context(), userID, spaceID, itemID, source.SourceIdentity, source.PreviewObjectKey, replacementKey)
			if repairErr != nil {
				_ = s.store.Delete(r.Context(), replacementKey)
				writeLibraryError(w, repairErr)
				return
			}
			if repairedKey != replacementKey {
				_ = s.store.Delete(r.Context(), replacementKey)
			}
			source.PreviewObjectKey = repairedKey
		} else if headErr != nil {
			writeLibraryError(w, headErr)
			return
		}
		if writeLibraryPreviewCacheHeaders(w, r, source.PreviewSHA256) {
			return
		}
		reader, metadata, err := s.store.Open(r.Context(), source.PreviewObjectKey)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		defer reader.Close()
		if metadata.ByteSize != source.PreviewBytes || metadata.SHA256 != source.PreviewSHA256 {
			writeJSON(w, http.StatusConflict, map[string]string{"code": "library_object_mismatch"})
			return
		}
		w.Header().Set("Content-Type", source.PreviewMIME)
		w.Header().Set("Content-Length", strconv.FormatInt(source.PreviewBytes, 10))
		w.Header().Set("Content-Disposition", "inline")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, reader)
	}
}

func writeLibraryPreviewCacheHeaders(w http.ResponseWriter, r *http.Request, sha string) bool {
	etag := `"` + sha + `"`
	w.Header().Set("ETag", etag)
	w.Header().Add("Vary", "Authorization, X-Misty-Library-Reauthentication")
	if strings.TrimSpace(r.URL.Query().Get("cache_version")) != "" {
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "private, no-cache")
	}
	for _, candidate := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			w.WriteHeader(http.StatusNotModified)
			return true
		}
	}
	return false
}

func (s *SpaceLibraryService) validateLibraryReauthentication(r *http.Request, userID, spaceID, scope string) error {
	token := strings.TrimSpace(r.Header.Get(libraryReauthenticationHeader))
	if token == "" {
		return db.ErrLibraryReauthentication
	}
	return s.database.ValidateLibraryReauthenticationGrant(r.Context(), userID, spaceID, scope, security.HashToken(token))
}

func (s *SpaceLibraryService) validateSensitiveLibraryItem(r *http.Request, userID, spaceID, itemID string) error {
	scope, err := s.database.SensitiveLibraryItemScope(r.Context(), userID, spaceID, itemID)
	if err != nil || scope == "" {
		return err
	}
	return s.validateLibraryReauthentication(r, userID, spaceID, scope)
}

func (s *SpaceLibraryService) validateSensitiveLibraryAssetStack(r *http.Request, userID, spaceID, stackID string) error {
	scope, err := s.database.SensitiveLibraryAssetStackScope(r.Context(), userID, spaceID, stackID)
	if err != nil || scope == "" {
		return err
	}
	return s.validateLibraryReauthentication(r, userID, spaceID, scope)
}

func (s *SpaceLibraryService) DownloadAttachment() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		download, err := s.database.MessageAttachmentDownload(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "attachmentID"))
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		s.writeDownload(w, r, download)
	}
}

func (s *SpaceLibraryService) PromoteAttachment() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		item, err := s.database.PromoteMessageAttachment(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "attachmentID"))
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, item)
	}
}

func (s *SpaceLibraryService) Albums() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			albums, err := s.database.LibraryAlbums(r.Context(), userID, spaceID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"albums": albums})
		case http.MethodPost:
			var body struct {
				Name        string `json:"name"`
				Description string `json:"description"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			album, err := s.database.CreateLibraryAlbum(r.Context(), userID, spaceID, body.Name, body.Description)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, album)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) Album() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, albumID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "albumID")
		switch r.Method {
		case http.MethodGet:
			album, err := s.database.LibraryAlbum(r.Context(), userID, spaceID, albumID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, album)
		case http.MethodPatch:
			var body struct {
				Version     int64  `json:"version"`
				Name        string `json:"name"`
				Description string `json:"description"`
				CoverItemID string `json:"cover_item_id"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			album, err := s.database.UpdateLibraryAlbum(r.Context(), userID, spaceID, albumID, body.Version, body.Name, body.Description, body.CoverItemID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, album)
		case http.MethodDelete:
			version, _ := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
			if err := s.database.DeleteLibraryAlbum(r.Context(), userID, spaceID, albumID, version); err != nil {
				writeLibraryError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) OrganizeAlbum() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Version  int64  `json:"version"`
			FolderID string `json:"folder_id"`
			ViewMode string `json:"view_mode"`
			SortMode string `json:"sort_mode"`
			Position int64  `json:"position"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		album, err := s.database.OrganizeLibraryAlbum(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "albumID"), body.Version, body.FolderID, body.ViewMode, body.SortMode, body.Position)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, album)
	}
}

func (s *SpaceLibraryService) AlbumFolders() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			folders, err := s.database.LibraryAlbumFolders(r.Context(), userID, spaceID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"folders": folders})
		case http.MethodPost:
			var body struct {
				Name           string `json:"name"`
				ParentFolderID string `json:"parent_folder_id"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			folder, err := s.database.CreateLibraryAlbumFolder(r.Context(), userID, spaceID, body.ParentFolderID, body.Name)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, folder)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) AlbumFolder() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, folderID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "folderID")
		switch r.Method {
		case http.MethodPatch:
			var body struct {
				Version        int64  `json:"version"`
				Name           string `json:"name"`
				ParentFolderID string `json:"parent_folder_id"`
				Position       int64  `json:"position"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			folder, err := s.database.UpdateLibraryAlbumFolder(r.Context(), userID, spaceID, folderID, body.Version, body.ParentFolderID, body.Name, body.Position)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, folder)
		case http.MethodDelete:
			version, _ := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
			if err := s.database.DeleteLibraryAlbumFolder(r.Context(), userID, spaceID, folderID, version); err != nil {
				writeLibraryError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) ReorderAlbumItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Version int64    `json:"version"`
			ItemIDs []string `json:"item_ids"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		album, err := s.database.ReorderLibraryAlbumItems(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "albumID"), body.Version, body.ItemIDs)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, album)
	}
}

func (s *SpaceLibraryService) AlbumItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, albumID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "albumID")
		switch r.Method {
		case http.MethodGet:
			items, err := s.database.LibraryAlbumItems(r.Context(), userID, spaceID, albumID, 200)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"items": items})
		case http.MethodPost:
			var body struct {
				ItemIDs []string `json:"item_ids"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			if err := s.database.AddLibraryAlbumItems(r.Context(), userID, spaceID, albumID, body.ItemIDs); err != nil {
				writeLibraryError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			if err := s.database.RemoveLibraryAlbumItem(r.Context(), userID, spaceID, albumID, chi.URLParam(r, "itemID")); err != nil {
				writeLibraryError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) Groups() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.groupsEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_groups_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			groups, err := s.database.LibraryGroups(r.Context(), userID, spaceID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
		case http.MethodPost:
			var body struct {
				Name  string               `json:"name"`
				Rules db.LibraryGroupRules `json:"rules"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			group, err := s.database.CreateLibraryGroup(r.Context(), userID, spaceID, body.Name, body.Rules)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, group)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) GroupItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.groupsEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_groups_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		items, err := s.database.LibraryGroupItems(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "groupID"), 200)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func (s *SpaceLibraryService) PeoplePolicy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			policy, err := s.database.LibraryPeoplePolicy(r.Context(), userID, spaceID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, policy)
		case http.MethodPatch:
			var body struct {
				Version               int64 `json:"version"`
				FacesEnabled          bool  `json:"faces_enabled"`
				PetsEnabled           bool  `json:"pets_enabled"`
				OCREnabled            bool  `json:"ocr_enabled"`
				AIEnabled             bool  `json:"ai_enabled"`
				SemanticSearchEnabled bool  `json:"semantic_search_enabled"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			if (!s.peopleEnabled && (body.FacesEnabled || body.PetsEnabled)) || (!s.ocrEnabled && body.OCREnabled) || (!s.aiEnabled && (body.AIEnabled || body.SemanticSearchEnabled)) {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_intelligence_disabled"})
				return
			}
			policy, err := s.database.UpdateLibraryIntelligencePolicy(r.Context(), userID, spaceID, body.Version, body.FacesEnabled, body.PetsEnabled, body.OCREnabled, body.AIEnabled, body.SemanticSearchEnabled)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, policy)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) People() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.peopleEnabled {
			if r.Method == http.MethodGet {
				writeJSON(w, http.StatusOK, map[string]any{"people": []any{}})
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_people_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			people, err := s.database.LibraryPeople(r.Context(), userID, spaceID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"people": people})
		case http.MethodPost:
			var body struct {
				Kind    string   `json:"kind"`
				Name    string   `json:"name"`
				ItemIDs []string `json:"item_ids"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			person, err := s.database.CreateLibraryPerson(r.Context(), userID, spaceID, body.Kind, body.Name, body.ItemIDs)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, person)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) Person() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.peopleEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_people_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, personID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "personID")
		switch r.Method {
		case http.MethodGet:
			person, err := s.database.LibraryPerson(r.Context(), userID, spaceID, personID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, person)
		case http.MethodPatch:
			var body struct {
				Version     int64  `json:"version"`
				Name        string `json:"name"`
				CoverItemID string `json:"cover_item_id"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			person, err := s.database.UpdateLibraryPerson(r.Context(), userID, spaceID, personID, body.Version, body.Name, body.CoverItemID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, person)
		case http.MethodDelete:
			version, _ := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
			if err := s.database.DeleteLibraryPerson(r.Context(), userID, spaceID, personID, version); err != nil {
				writeLibraryError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) PersonItems() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.peopleEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_people_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, personID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "personID")
		switch r.Method {
		case http.MethodGet:
			items, err := s.database.LibraryPersonItems(r.Context(), userID, spaceID, personID, 200)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"items": items})
		case http.MethodPost, http.MethodDelete:
			var body struct {
				ItemIDs []string `json:"item_ids"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			var person *db.LibraryPerson
			var err error
			if r.Method == http.MethodPost {
				person, err = s.database.AddLibraryPersonItems(r.Context(), userID, spaceID, personID, body.ItemIDs)
			} else {
				person, err = s.database.RemoveLibraryPersonItems(r.Context(), userID, spaceID, personID, body.ItemIDs)
			}
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, person)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) MergePeople() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.peopleEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_people_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			SourceID      string `json:"source_id"`
			TargetID      string `json:"target_id"`
			SourceVersion int64  `json:"source_version"`
			TargetVersion int64  `json:"target_version"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		person, err := s.database.MergeLibraryPeople(r.Context(), userID, chi.URLParam(r, "spaceID"), body.SourceID, body.TargetID, body.SourceVersion, body.TargetVersion)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, person)
	}
}

func (s *SpaceLibraryService) EditVersions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.editingEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_editing_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, itemID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "itemID")
		if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
			writeLibraryError(w, err)
			return
		}
		switch r.Method {
		case http.MethodGet:
			versions, err := s.database.LibraryEditVersions(r.Context(), userID, spaceID, itemID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"versions": versions})
		case http.MethodPost:
			var body struct {
				ItemVersion    int64                    `json:"item_version"`
				EditDefinition db.LibraryEditDefinition `json:"edit_definition"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			result, err := s.database.CreateLibraryEditVersion(r.Context(), userID, spaceID, itemID, body.ItemVersion, body.EditDefinition)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, result)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) SelectEditVersion() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.editingEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_editing_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, itemID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "itemID")
		if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
			writeLibraryError(w, err)
			return
		}
		var body struct {
			ItemVersion int64  `json:"item_version"`
			EditID      string `json:"edit_id"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		result, err := s.database.SelectLibraryEditVersion(r.Context(), userID, spaceID, itemID, body.EditID, body.ItemVersion)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func (s *SpaceLibraryService) DeleteEditVersion() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.editingEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_editing_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, itemID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "itemID")
		if err := s.validateSensitiveLibraryItem(r, userID, spaceID, itemID); err != nil {
			writeLibraryError(w, err)
			return
		}
		if err := s.database.DeleteLibraryEditVersion(r.Context(), userID, spaceID, itemID, chi.URLParam(r, "editID")); err != nil {
			writeLibraryError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpaceLibraryService) MemberPermissions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, memberID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "userID")
		switch r.Method {
		case http.MethodGet:
			permissions, err := s.database.SpaceMemberPermissions(r.Context(), userID, spaceID, memberID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"permissions": permissions})
		case http.MethodPut:
			var body struct {
				Permission string `json:"permission"`
				Effect     string `json:"effect"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			if err := s.database.SetSpaceMemberPermission(r.Context(), userID, spaceID, memberID, body.Permission, body.Effect); err != nil {
				writeLibraryError(w, err)
				return
			}
			permissions, err := s.database.SpaceMemberPermissions(r.Context(), userID, spaceID, memberID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"permissions": permissions})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpaceLibraryService) writeDownload(w http.ResponseWriter, r *http.Request, download *db.LibraryDownload) {
	reader, metadata, err := s.store.Open(r.Context(), download.ObjectKey)
	if err != nil {
		writeLibraryError(w, err)
		return
	}
	defer reader.Close()
	if metadata.ByteSize != download.ByteSize || metadata.SHA256 != download.SHA256 {
		writeJSON(w, http.StatusConflict, map[string]string{"code": "library_object_mismatch"})
		return
	}
	w.Header().Set("Content-Type", download.MIMEType)
	w.Header().Set("Content-Length", strconv.FormatInt(download.ByteSize, 10))
	filename := download.Filename
	if download.Rendition {
		filename = libraryRenditionFilename(filename, download.MIMEType)
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": sanitizeLibraryFilename(filename)}))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, reader)
}

func libraryRenditionFilename(filename, mimeType string) string {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	if strings.TrimSpace(base) == "" {
		base = "edited"
	} else {
		base += "-edited"
	}
	extension := ".bin"
	switch strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0])) {
	case "image/jpeg":
		extension = ".jpg"
	case "video/mp4":
		extension = ".mp4"
	}
	return base + extension
}

func libraryRenditionIntrinsicMetadata(source db.LibraryTransferItem) json.RawMessage {
	metadata := map[string]any{}
	_ = json.Unmarshal(source.IntrinsicMetadata, &metadata)
	metadata["byte_size"] = source.ByteSize
	metadata["server_detected_mime_type"] = source.MIMEType
	metadata["edited_from_item_id"] = source.ItemID
	var definition db.LibraryEditDefinition
	if json.Unmarshal(source.RenditionDefinition, &definition) == nil {
		width, widthOK := metadataNumber(metadata["width"])
		height, heightOK := metadataNumber(metadata["height"])
		if widthOK && heightOK {
			if definition.Crop != nil {
				width *= definition.Crop.Width
				height *= definition.Crop.Height
			}
			if definition.Rotation == 90 || definition.Rotation == 270 {
				width, height = height, width
			}
			metadata["width"], metadata["height"] = int64(math.Round(width)), int64(math.Round(height))
		}
		if definition.Trim != nil {
			metadata["duration"] = definition.Trim.End - definition.Trim.Start
		}
		metadata["edit_definition"] = definition
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return raw
}

func metadataNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func (s *SpaceLibraryService) rejectAndDelete(ctx context.Context, upload *db.LibraryUpload, tokenHash, state, code string) {
	_ = s.database.RejectLibraryUpload(ctx, upload.UserID, upload.SpaceID, upload.ID, tokenHash, state, code)
	_ = s.store.Delete(ctx, upload.ObjectKey)
}

var errLibraryMalware = errors.New("malware detected")

type libraryInspectionError struct{ code string }

func (e libraryInspectionError) Error() string { return e.code }

func libraryInspectionCode(err error) string {
	if errors.Is(err, errLibraryMalware) {
		return "malware_detected"
	}
	var typed libraryInspectionError
	if errors.As(err, &typed) {
		return typed.code
	}
	return "content_rejected"
}

func inspectLibraryContent(reader io.Reader, byteSize int64, filename, declaredMIME string) (string, map[string]any, error) {
	if byteSize < 1 || byteSize > db.MaxSpaceStorageBytes {
		return "", nil, libraryInspectionError{code: "invalid_size"}
	}
	extension := strings.ToLower(filepath.Ext(filename))
	blockedExtensions := map[string]bool{".exe": true, ".dll": true, ".dylib": true, ".so": true, ".sh": true, ".bash": true, ".zsh": true, ".bat": true, ".cmd": true, ".ps1": true, ".js": true, ".mjs": true, ".html": true, ".htm": true, ".svg": true, ".jar": true, ".app": true, ".dmg": true, ".pkg": true, ".iso": true, ".zip": true, ".rar": true, ".7z": true, ".gz": true, ".tar": true}
	if blockedExtensions[extension] {
		return "", nil, libraryInspectionError{code: "dangerous_file_type"}
	}
	hasher := sha256.New()
	buffered := bufio.NewReaderSize(io.LimitReader(reader, byteSize+1), 64*1024)
	first := make([]byte, 512)
	n, firstErr := io.ReadFull(buffered, first)
	if firstErr != nil && !errors.Is(firstErr, io.ErrUnexpectedEOF) && !errors.Is(firstErr, io.EOF) {
		return "", nil, firstErr
	}
	first = first[:n]
	_, _ = hasher.Write(first)
	detected := http.DetectContentType(first)
	blockedMIMEs := []string{"text/html", "image/svg+xml", "application/x-msdownload", "application/x-sh", "application/javascript", "text/javascript"}
	for _, blocked := range blockedMIMEs {
		if strings.EqualFold(strings.TrimSpace(strings.Split(detected, ";")[0]), blocked) {
			return "", nil, libraryInspectionError{code: "dangerous_file_type"}
		}
	}
	eicar := []byte("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")
	tail := append([]byte(nil), first...)
	foundEICAR := bytesContains(tail, eicar)
	readBytes := int64(len(first))
	chunk := make([]byte, 64*1024)
	for {
		n, err := buffered.Read(chunk)
		if n > 0 {
			readBytes += int64(n)
			_, _ = hasher.Write(chunk[:n])
			window := append(tail, chunk[:n]...)
			if bytesContains(window, eicar) {
				foundEICAR = true
			}
			keep := len(eicar) - 1
			if len(window) > keep {
				tail = append(tail[:0], window[len(window)-keep:]...)
			} else {
				tail = append(tail[:0], window...)
			}
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", nil, err
		}
	}
	if readBytes != byteSize {
		return "", nil, libraryInspectionError{code: "verification_mismatch"}
	}
	if foundEICAR {
		return "", nil, errLibraryMalware
	}
	return detected, map[string]any{
		"sha256":                    hex.EncodeToString(hasher.Sum(nil)),
		"byte_size":                 byteSize,
		"server_detected_mime_type": detected,
		"client_declared_mime_type": strings.TrimSpace(declaredMIME),
	}, nil
}

func bytesContains(data, pattern []byte) bool {
	return strings.Contains(string(data), string(pattern))
}

func sanitizeLibraryFilename(value string) string {
	value = strings.TrimSpace(filepath.Base(strings.ReplaceAll(value, "\\", "/")))
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '/' || r == '\\' {
			return -1
		}
		return r
	}, value)
	if len([]rune(value)) > 255 {
		value = string([]rune(value)[:255])
	}
	return value
}

func writeLibraryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrLibraryNotFound), errors.Is(err, ErrLibraryObjectNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"code": "not_found"})
	case errors.Is(err, db.ErrLibraryForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"code": "forbidden"})
	case errors.Is(err, db.ErrLibraryReauthentication):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "library_reauthentication_required"})
	case errors.Is(err, db.ErrLibraryInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_request"})
	case errors.Is(err, db.ErrLibraryQuota):
		writeJSON(w, http.StatusConflict, map[string]any{"code": "space_storage_quota_exceeded", "limit_bytes": db.MaxSpaceStorageBytes})
	case errors.Is(err, db.ErrLibraryConflict):
		writeJSON(w, http.StatusConflict, map[string]string{"code": "version_conflict"})
	case errors.Is(err, db.ErrLibraryUploadMismatch):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"code": "upload_verification_failed"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"code": "internal_error"})
	}
}
