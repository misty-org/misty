package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
)

type libraryIntelligencePayload struct {
	OCR      bool `json:"ocr"`
	AI       bool `json:"ai"`
	Semantic bool `json:"semantic"`
}

func (s *SpaceLibraryService) ProcessIntelligenceJobs(ctx context.Context, workerID string, limit int) (int, error) {
	if s.intelligence == nil || !s.aiEnabled && !s.ocrEnabled {
		return 0, nil
	}
	if limit < 1 || limit > 20 {
		limit = 2
	}
	processed := 0
	for processed < limit {
		job, err := s.database.ClaimLibraryIntelligenceJob(ctx, workerID, 3*time.Minute)
		if err != nil {
			return processed, err
		}
		if job == nil {
			return processed, nil
		}
		processed++
		if err := s.processIntelligenceJob(ctx, job); err != nil {
			code := "provider_failed"
			var insufficient db.InsufficientCreditsError
			switch {
			case errors.As(err, &insufficient):
				code = "insufficient_credits"
			case errors.Is(err, errLibraryUnsupportedIntelligenceMedia):
				code = "unsupported_media"
			case errors.Is(err, db.ErrLibraryForbidden):
				code = "policy_disabled"
			}
			_ = s.database.FailLibraryIntelligenceJob(ctx, job, code)
		}
	}
	return processed, nil
}

var errLibraryUnsupportedIntelligenceMedia = errors.New("unsupported Library intelligence media")

func (s *SpaceLibraryService) processIntelligenceJob(ctx context.Context, job *db.LibraryIntelligenceJob) error {
	var payload libraryIntelligencePayload
	if json.Unmarshal(job.Payload, &payload) != nil || !payload.OCR && !payload.AI && !payload.Semantic {
		return db.ErrLibraryForbidden
	}
	asset, err := s.libraryIntelligenceAsset(ctx, job)
	if err != nil {
		return err
	}
	tier := db.TierBasic
	if license, licenseErr := s.database.GetLicenseByUserID(job.BillingUserID); licenseErr == nil && license != nil {
		tier = license.Tier
	}
	reservation, _, err := s.database.ReserveCredits(job.BillingUserID, tier, db.CreditMeterAssetAnalysisImage, "space-library-intelligence:"+job.ID, db.CreditDenominationScale, time.Now())
	if err != nil {
		return err
	}
	settled := false
	defer func() {
		if !settled && reservation != nil {
			_ = s.database.ReleaseCreditReservation(reservation.ID)
		}
	}()
	analysis, err := s.intelligence.Analyze(ctx, []serveragent.SmartLibraryAsset{asset})
	if err != nil || len(analysis.Results) != 1 {
		if err != nil {
			return err
		}
		return errors.New("Library intelligence returned no result")
	}
	metadata := analysis.Results[0]
	var vector []float64
	if payload.Semantic {
		embeddings, usage, embedErr := s.intelligence.EmbedAssets(ctx, []serveragent.SmartLibraryAsset{asset}, map[string]serveragent.SmartLibraryMetadata{asset.AssetID: metadata})
		analysis.Usage.InputTokens += usage.InputTokens
		analysis.Usage.CachedInputTokens += usage.CachedInputTokens
		analysis.Usage.OutputTokens += usage.OutputTokens
		if embedErr != nil || len(embeddings) != 1 {
			if embedErr != nil {
				return embedErr
			}
			return errors.New("Library intelligence embedding missing")
		}
		vector = embeddings[0].Vector
	}
	rawMetadata, _ := json.Marshal(metadata)
	searchText := strings.Join([]string{job.DisplayName, job.Filename, job.Caption, strings.Join(job.Tags, " "), metadata.SearchDocument()}, " | ")
	if err := s.database.CompleteLibraryIntelligenceJob(ctx, job, db.LibraryIntelligenceResult{Metadata: rawMetadata, SearchText: searchText, Embedding: vector, Model: serveragent.SmartLibraryEmbeddingModel, Version: serveragent.SmartLibraryIndexVersion}); err != nil {
		return err
	}
	if reservation != nil {
		_, err = s.database.SettleCreditReservation(reservation.ID, "space-library-intelligence-settle:"+job.ID, db.CreditUsage{Provider: "vercel_ai_gateway", Model: metadata.Model, InputTokens: analysis.Usage.InputTokens, CachedInputTokens: analysis.Usage.CachedInputTokens, OutputTokens: analysis.Usage.OutputTokens, Credits: db.CreditDenominationScale})
		if err != nil {
			return err
		}
	}
	settled = true
	return nil
}

func (s *SpaceLibraryService) libraryIntelligenceAsset(ctx context.Context, job *db.LibraryIntelligenceJob) (serveragent.SmartLibraryAsset, error) {
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(job.MIMEType, ";")[0]))
	asset := serveragent.SmartLibraryAsset{AssetID: job.ItemID, AssetKind: "binary", MimeType: "application/octet-stream", Metadata: map[string]string{"filename": job.Filename, "displayName": job.DisplayName, "caption": job.Caption, "tags": strings.Join(job.Tags, ", "), "originalMimeType": mimeType}}
	switch {
	case mimeType == "image/jpeg" || mimeType == "image/png":
		if job.ByteSize > serveragent.SmartLibraryMaxAssetBytes {
			return asset, errLibraryUnsupportedIntelligenceMedia
		}
		reader, metadata, err := s.store.Open(ctx, job.ObjectKey)
		if err != nil {
			return asset, err
		}
		defer reader.Close()
		if metadata.ByteSize != job.ByteSize {
			return asset, errors.New("Library intelligence object size mismatch")
		}
		data, err := io.ReadAll(io.LimitReader(reader, serveragent.SmartLibraryMaxAssetBytes+1))
		if err != nil || len(data) > serveragent.SmartLibraryMaxAssetBytes {
			return asset, errLibraryUnsupportedIntelligenceMedia
		}
		asset.AssetKind, asset.MimeType, asset.Bytes = "image", mimeType, data
	case strings.HasPrefix(mimeType, "text/") && job.ByteSize <= serveragent.SmartLibraryMaxTextBytes:
		reader, _, err := s.store.Open(ctx, job.ObjectKey)
		if err != nil {
			return asset, err
		}
		defer reader.Close()
		data, err := io.ReadAll(io.LimitReader(reader, serveragent.SmartLibraryMaxTextBytes+1))
		if err != nil || len(data) > serveragent.SmartLibraryMaxTextBytes {
			return asset, errLibraryUnsupportedIntelligenceMedia
		}
		asset.AssetKind, asset.MimeType, asset.ExtractedText = "text", mimeType, string(data)
	case strings.HasPrefix(mimeType, "application/pdf"):
		asset.AssetKind, asset.MimeType = "document", mimeType
	}
	return asset, nil
}

func (s *SpaceLibraryService) SemanticSearch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.aiEnabled || s.intelligence == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "library_ai_disabled"})
			return
		}
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		if query == "" || len([]rune(query)) > 256 {
			writeLibraryError(w, db.ErrLibraryInvalid)
			return
		}
		vector, _, embedErr := s.intelligence.EmbedQuery(r.Context(), query)
		if embedErr != nil {
			vector = nil
		}
		items, err := s.database.SearchSpaceLibraryIntelligence(r.Context(), userID, chi.URLParam(r, "spaceID"), query, vector, 100)
		if err != nil {
			writeLibraryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "semantic": len(vector) > 0, "request_id": "search_" + uuid.NewString()})
	}
}
