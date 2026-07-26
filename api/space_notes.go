package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kannachi323/misty/server/db"
	"github.com/kannachi323/misty/server/security"
)

// SpaceNotes handles the note collection: listing the caller's accessible
// notes and creating a new private one.
func (s *SpacesService) SpaceNotes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			notes, err := s.database.AccessibleSpaceNotes(r.Context(), userID, spaceID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"notes": notes})
		case http.MethodPost:
			var body struct {
				Title string `json:"title"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			note, err := s.database.CreateSpaceNote(r.Context(), userID, spaceID, body.Title)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, note)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// SpaceNote handles one note: reading it and deleting it. Both behave as
// not-found for any caller without the matching capability, so neither reveals
// that the note exists.
func (s *SpacesService) SpaceNote() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		noteID := chi.URLParam(r, "noteID")
		switch r.Method {
		case http.MethodGet:
			note, err := s.database.SpaceNoteByID(r.Context(), userID, noteID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			if note.SpaceID != chi.URLParam(r, "spaceID") {
				// The note exists but was requested under the wrong Space. Answer
				// as if it does not exist rather than confirming it elsewhere.
				writeSpaceError(w, db.ErrSpaceNotFound)
				return
			}
			writeJSON(w, http.StatusOK, note)
		case http.MethodDelete:
			if err := s.database.DeleteSpaceNote(r.Context(), userID, noteID); err != nil {
				writeSpaceError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// SpaceNoteMetadata updates server-owned, non-CRDT metadata. Collaborative
// title and body changes never arrive here: they reach PostgreSQL only as
// projections from the collaboration service.
func (s *SpacesService) SpaceNoteMetadata() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			SharedTags []string `json:"shared_tags"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		noteID := chi.URLParam(r, "noteID")
		if err := s.database.UpdateNoteSharedTags(r.Context(), userID, noteID, body.SharedTags); err != nil {
			writeSpaceError(w, err)
			return
		}
		note, err := s.database.SpaceNoteByID(r.Context(), userID, noteID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, note)
	}
}

// SpaceNotePermissions reads and replaces the full grant set. Both are
// creator-only; everyone else, including the Space owner, gets not-found.
//
// PUT takes the complete desired set rather than a delta, so a client that
// raced with another change cannot silently re-add a grant the creator just
// removed.
func (s *SpacesService) SpaceNotePermissions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		noteID := chi.URLParam(r, "noteID")
		switch r.Method {
		case http.MethodGet:
			grants, err := s.database.NoteGrants(r.Context(), userID, noteID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"grants": grants})
		case http.MethodPut:
			var body struct {
				Grants []db.NoteGrant `json:"grants"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			aclVersion, changed, err := s.database.ReplaceNoteGrants(r.Context(), userID, noteID, body.Grants)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"acl_version": aclVersion, "changed": changed, "grants": body.Grants,
			})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// SpaceNoteAssets lists a note's assets and initiates a new asset upload.
//
// The note_attachment purpose is rejected by the generic Library upload
// endpoint, so this is the only route that can create one, and it authorizes
// against the parent note before reserving any quota.
func (s *SpaceLibraryService) SpaceNoteAssets() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		noteID := chi.URLParam(r, "noteID")
		if r.Method == http.MethodGet {
			assets, err := s.database.NoteAssets(r.Context(), userID, noteID)
			if err != nil {
				writeLibraryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"assets": assets})
			return
		}
		if !s.noteAssetsEnabled {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "note_assets_disabled"})
			return
		}
		var body struct {
			Filename string `json:"filename"`
			MIMEType string `json:"mime_type"`
			ByteSize int64  `json:"byte_size"`
			SHA256   string `json:"sha256"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		body.Filename = sanitizeLibraryFilename(body.Filename)
		body.SHA256 = strings.ToLower(strings.TrimSpace(body.SHA256))
		body.MIMEType = strings.TrimSpace(body.MIMEType)
		maxBytes := s.uploadLimits.Max(UploadPurposeNoteAttachment)
		if maxBytes < 1 || body.ByteSize < 1 || body.ByteSize > maxBytes ||
			!librarySHA256Pattern.MatchString(body.SHA256) || body.Filename == "" {
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
		upload, err := s.database.CreateNoteAssetUpload(r.Context(), userID, noteID, body.Filename,
			body.MIMEType, body.ByteSize, body.SHA256, objectKey, security.HashToken(token), expiresAt)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		transfer, err := s.uploadTransfer(r.Context(), upload, token, expiresAt)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"upload":   upload,
			"transfer": transfer,
			"finalize": map[string]any{"headers": map[string]string{libraryUploadTokenHeader: token}},
		})
	}
}

// SpaceNoteAssetDownload issues an authorized download for one asset. Viewers
// may download; only uploading and removal require edit access.
func (s *SpaceLibraryService) SpaceNoteAssetDownload() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		download, err := s.database.NoteAssetDownload(r.Context(), userID,
			chi.URLParam(r, "noteID"), chi.URLParam(r, "assetID"))
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		s.writeDownload(w, r, download)
	}
}

// SpaceNoteAsset removes one asset reference.
func (s *SpaceLibraryService) SpaceNoteAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if err := s.database.DeleteNoteAsset(r.Context(), userID,
			chi.URLParam(r, "noteID"), chi.URLParam(r, "assetID")); err != nil {
			writeLibraryError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// SpaceNoteCollaborationTicket mints a short-lived, single-connection ticket
// for the collaboration service.
//
// Access is rechecked here rather than trusted from the note fetch that
// preceded it, because a grant can be revoked between the two calls.
func (s *SpacesService) SpaceNoteCollaborationTicket() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		access, err := s.database.RequireNoteView(r.Context(), userID, chi.URLParam(r, "noteID"))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		// Authorization is settled; signing is not yet configured. Failing here
		// keeps the desktop on an explicit unavailable state rather than letting
		// it fall back to insecure local-only notes.
		_ = access
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "note_collaboration_unavailable"})
	}
}
