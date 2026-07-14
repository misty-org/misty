package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
)

var errSemanticSearchRateLimited = errors.New("semantic search rate limited")

const (
	smartLibrarySampleSize = 25
	smartLibraryLimit      = 500
	smartLibraryBatchSize  = 8
)

type SmartLibraryService struct {
	database     *db.Database
	analyzer     *serveragent.SmartLibraryAnalyzer
	searchMu     sync.Mutex
	queryCache   map[[32]byte]cachedSemanticQuery
	queryWindows map[[32]byte]semanticQueryWindow
}

type cachedSemanticQuery struct {
	vector  []float64
	expires time.Time
}
type semanticQueryWindow struct {
	started time.Time
	count   int
}

func NewSmartLibraryService(database *db.Database, analyzers ...*serveragent.SmartLibraryAnalyzer) *SmartLibraryService {
	service := &SmartLibraryService{database: database, queryCache: map[[32]byte]cachedSemanticQuery{}, queryWindows: map[[32]byte]semanticQueryWindow{}}
	if len(analyzers) > 0 {
		service.analyzer = analyzers[0]
	}
	return service
}

func (s *SmartLibraryService) RegisterFolder() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		var body struct {
			ClientLibraryID string `json:"clientLibraryId"`
			SourceKind      string `json:"sourceKind"`
			PilotLimit      int    `json:"pilotLimit"`
		}
		if decodeAIJSON(w, r, &body) != nil || !validOpaqueID(body.ClientLibraryID, "lib_") || (body.SourceKind != "local" && body.SourceKind != "cloud") || body.PilotLimit != smartLibraryLimit {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		folder, err := s.database.RegisterSmartLibraryFolder(userID, body.ClientLibraryID, body.SourceKind)
		switch {
		case errors.Is(err, db.ErrSmartLibraryActiveFolder):
			writeJSON(w, http.StatusConflict, map[string]any{"code": "smart_library_root_exists", "message": "Remove the active Smart Library before choosing another folder."})
		case err != nil:
			http.Error(w, "internal error", 500)
		default:
			writeJSON(w, http.StatusCreated, map[string]any{"folderId": folder.ID, "allowance": allowance(folder)})
		}
	}
}

func (s *SmartLibraryService) Preflight() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		folderID := chi.URLParam(r, "folderID")
		var body struct {
			TotalImages           int `json:"totalImages"`
			SupportedImages       int `json:"supportedImages"`
			UnsupportedImages     int `json:"unsupportedImages"`
			AlreadyAnalyzedImages int `json:"alreadyAnalyzedImages"`
			ChangedImages         int `json:"changedImages"`
			EligibleImages        int `json:"eligibleImages"`
			RequestedImages       int `json:"requestedImages"`
		}
		if decodeAIJSON(w, r, &body) != nil || body.TotalImages < 0 || body.SupportedImages < 0 || body.UnsupportedImages < 0 || body.EligibleImages < 0 {
			http.Error(w, "invalid request", 400)
			return
		}
		requested := min(body.RequestedImages, body.EligibleImages, smartLibraryLimit)
		folder, err := s.database.SetSmartLibraryEstimate(userID, folderID, requested)
		if !s.writeFolderError(w, err) {
			return
		}
		writeJSON(w, 200, map[string]any{"estimate": estimate(folder)})
	}
}

func (s *SmartLibraryService) CreateSample() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		folderID := chi.URLParam(r, "folderID")
		var body struct {
			Candidates          []db.SmartLibraryCandidate `json:"candidates"`
			MaximumSampleImages int                        `json:"maximumSampleImages"`
		}
		if decodeAIJSON(w, r, &body) != nil || body.MaximumSampleImages != smartLibrarySampleSize || len(body.Candidates) > smartLibrarySampleSize {
			http.Error(w, "invalid request", 400)
			return
		}
		for _, candidate := range body.Candidates {
			if !validOpaqueID(candidate.AssetID, "asset_") || len(candidate.Fingerprint) != 64 || candidate.SizeBytes < 0 || !validAssetDescriptor(candidate.AssetKind, candidate.MimeType) {
				http.Error(w, "invalid request", 400)
				return
			}
		}
		ids, err := s.database.CreateSmartLibrarySample(userID, folderID, body.Candidates)
		if !s.writeFolderError(w, err) {
			return
		}
		folder, _ := s.database.SmartLibraryFolder(userID, folderID)
		writeJSON(w, 200, map[string]any{"assetIds": ids, "estimate": estimate(folder)})
	}
}

func (s *SmartLibraryService) Approve(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		if strings.EqualFold(strings.TrimSpace(os.Getenv("SMART_LIBRARY_EMERGENCY_DISABLE")), "true") {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "smart_library_disabled", "message": "Mika image analysis is temporarily disabled. No images were charged."})
			return
		}
		if s.analyzer == nil || strings.TrimSpace(s.analyzer.APIKey) == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "smart_library_unavailable", "message": "Mika image analysis is not configured. No images were charged."})
			return
		}
		var body smartLibraryApproval
		if decodeSmartLibraryJSON(w, r, &body) != nil || body.BillingMeter != db.CreditMeterAssetAnalysisImage || len(body.Previews) == 0 || len(body.Previews) > smartLibraryBatchSize || (body.MaximumSuccessfulImages != 0 && body.MaximumSuccessfulImages != smartLibraryLimit) {
			http.Error(w, "invalid request", 400)
			return
		}
		refs := make([]db.SmartLibraryPreviewRef, 0, len(body.Previews))
		assets := make([]serveragent.SmartLibraryAsset, 0, len(body.Previews))
		totalBytes := 0
		for _, preview := range body.Previews {
			var raw []byte
			var err error
			if preview.Base64 != "" {
				raw, err = base64.StdEncoding.DecodeString(preview.Base64)
			}
			assetKind := strings.ToLower(strings.TrimSpace(preview.AssetKind))
			if assetKind == "" {
				assetKind = "image"
			}
			asset := serveragent.SmartLibraryAsset{AssetID: preview.AssetID, AssetKind: assetKind, MimeType: strings.ToLower(strings.TrimSpace(preview.MimeType)), Bytes: raw, ExtractedText: preview.ExtractedText, Metadata: preview.Metadata}
			if preview.Truncated {
				if asset.Metadata == nil {
					asset.Metadata = map[string]string{}
				}
				asset.Metadata["contentTruncated"] = "true"
			}
			if err != nil || !validOpaqueID(preview.AssetID, "asset_") || len(preview.Fingerprint) != 64 || len(raw) > 1<<20 || serveragent.ValidateSmartLibraryAsset(asset) != nil {
				http.Error(w, "invalid request", 400)
				return
			}
			totalBytes += len(raw)
			refs = append(refs, db.SmartLibraryPreviewRef{AssetID: preview.AssetID, Fingerprint: preview.Fingerprint, AssetKind: asset.AssetKind, MimeType: asset.MimeType})
			assets = append(assets, asset)
		}
		if totalBytes > 4<<20 {
			http.Error(w, "preview batch too large", http.StatusRequestEntityTooLarge)
			return
		}
		folderID := chi.URLParam(r, "folderID")
		batch, err := s.database.CreateSmartLibraryBatch(userID, folderID, kind, refs)
		if !s.writeFolderError(w, err) {
			return
		}
		var reservation *db.CreditReservation
		if kind != "sample" {
			tier := db.TierBasic
			license, licenseErr := s.database.GetLicenseByUserID(userID)
			if licenseErr != nil {
				_ = s.database.ResetSmartLibraryBatch(batch.ID)
				http.Error(w, "internal error", 500)
				return
			}
			if license != nil {
				tier = license.Tier
			}
			reservation, _, err = s.database.ReserveCredits(userID, tier, db.CreditMeterAssetAnalysisImage, "smart-library:"+batch.ID, int64(len(assets))*db.CreditDenominationScale, time.Now())
			if err != nil {
				_ = s.database.ResetSmartLibraryBatch(batch.ID)
				var insufficient db.InsufficientCreditsError
				if errors.As(err, &insufficient) {
					writeJSON(w, http.StatusPaymentRequired, map[string]any{"code": "insufficient_credits", "message": "Not enough Mika credits to analyze this batch.", "requiredCredits": insufficient.Required / db.CreditDenominationScale, "availableCredits": insufficient.Available / db.CreditDenominationScale})
					return
				}
				http.Error(w, "internal error", 500)
				return
			}
		}
		analysis, analysisErr := s.analyzer.Analyze(r.Context(), assets)
		failures := analysis.Failures
		if failures == nil {
			failures = map[string]string{}
		}
		resolved := map[string]bool{}
		completions := make([]db.SmartLibraryCompletion, 0, len(analysis.Results))
		var embeddingTokens int64
		embeddingCount := 0
		assetsByID := map[string]serveragent.SmartLibraryAsset{}
		for _, asset := range assets {
			assetsByID[asset.AssetID] = asset
		}
		for _, result := range analysis.Results {
			resolved[result.AssetID] = true
			delete(failures, result.AssetID)
			completion := db.SmartLibraryCompletion{AssetID: result.AssetID, Description: result.Description, Tags: result.Tags, Collections: result.SuggestedCollections, Confidence: result.Confidence, Model: result.Model, FallbackReason: result.FallbackReason, AssetKind: assetsByID[result.AssetID].AssetKind, MimeType: assetsByID[result.AssetID].MimeType, Metadata: richMetadata(result)}
			embeddings, usage, embedErr := s.analyzer.EmbedAssets(r.Context(), []serveragent.SmartLibraryAsset{assetsByID[result.AssetID]}, map[string]serveragent.SmartLibraryMetadata{result.AssetID: result})
			analysis.Usage.InputTokens += usage.InputTokens
			embeddingTokens += usage.InputTokens
			if embedErr == nil && len(embeddings) == 1 {
				embeddingCount++
				completion.Embedding = embeddings[0].Vector
				completion.EmbeddingModel = embeddings[0].Model
				completion.EmbeddingVersion = embeddings[0].Version
				completion.EmbeddingInputHash = embeddings[0].InputHash
			}
			completions = append(completions, completion)
		}
		for id := range failures {
			resolved[id] = true
		}
		for _, asset := range assets {
			if !resolved[asset.AssetID] {
				code := "analysis_failed"
				if analysisErr != nil {
					code = "provider_failed"
				}
				failures[asset.AssetID] = code
			}
		}
		_ = s.database.RecordSmartLibraryCostEvent(userID, folderID, batch.ID, "smart-library-routing", len(assets), analysis.Usage.InputTokens, analysis.Usage.OutputTokens, len(analysis.Results) > 0)
		if embeddingTokens > 0 {
			_ = s.database.RecordSmartLibrarySemanticUsage(userID, folderID, "semantic_index", currentEmbeddingModel(), embeddingCount, embeddingTokens, 0, true)
		}
		folder, err := s.database.CompleteSmartLibraryBatch(userID, batch.ID, completions, failures, body.FinalBatch)
		if err != nil {
			if reservation != nil {
				_ = s.database.ReleaseCreditReservation(reservation.ID)
			}
			_ = s.database.ResetSmartLibraryBatch(batch.ID)
			http.Error(w, "internal error", 500)
			return
		}
		if reservation != nil {
			if len(completions) == 0 {
				_ = s.database.ReleaseCreditReservation(reservation.ID)
			} else if _, err = s.database.SettleCreditReservation(reservation.ID, "smart-library-settle:"+batch.ID, db.CreditUsage{Provider: "vercel_ai_gateway", Model: "smart-library-routing", InputTokens: analysis.Usage.InputTokens, CachedInputTokens: analysis.Usage.CachedInputTokens, OutputTokens: analysis.Usage.OutputTokens, Credits: int64(len(completions)) * db.CreditDenominationScale}); err != nil {
				_ = s.database.ReleaseCreditReservation(reservation.ID)
				http.Error(w, "internal error", 500)
				return
			}
		}
		batch.Status = "completed"
		if len(completions) == 0 {
			batch.Status = "failed"
		} else if len(failures) > 0 {
			batch.Status = "partially_failed"
		}
		batch.SuccessfulImages = len(completions)
		batch.FailedImages = len(failures)
		writeJSON(w, http.StatusOK, progressPayload(folder, []db.SmartLibraryBatch{*batch}))
	}
}

func (s *SmartLibraryService) Progress() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		folderID := chi.URLParam(r, "folderID")
		if err := s.database.RecoverStaleSmartLibraryBatches(userID, folderID); err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		folder, err := s.database.SmartLibraryFolder(userID, folderID)
		if !s.writeFolderError(w, err) {
			return
		}
		phase := folder.State
		if phase == "preflight" {
			phase = "sample_ready"
		}
		batches, err := s.database.SmartLibraryBatches(userID, folder.ID)
		if err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		payload := progressPayload(folder, batches)
		sampleAssetIDs, err := s.database.SmartLibrarySampleAssetIDs(userID, folder.ID)
		if err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		payload["sampleAssetIds"] = sampleAssetIDs
		payload["phase"] = phase
		if indexStatus, indexErr := s.database.SmartLibraryIndexStatusForUser(userID, folder.ID, currentEmbeddingModel(), serveragent.SmartLibraryIndexVersion); indexErr == nil {
			payload["indexStatus"] = map[string]any{"currentVersion": indexStatus.CurrentVersion, "embeddingModel": indexStatus.EmbeddingModel, "outdatedAssets": indexStatus.OutdatedAssets, "failedAssets": indexStatus.FailedAssets, "upgradeNeeded": indexStatus.OutdatedAssets > 0}
		}
		writeJSON(w, 200, payload)
	}
}

func (s *SmartLibraryService) Results() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		results, next, err := s.database.SmartLibraryResults(userID, chi.URLParam(r, "folderID"), after)
		if !s.writeFolderError(w, err) {
			return
		}
		payload := make([]map[string]any, 0, len(results))
		for _, result := range results {
			payload = append(payload, map[string]any{"assetId": result.AssetID, "status": result.Status, "assetKind": result.AssetKind, "mimeType": result.MimeType, "description": result.Description, "tags": result.Tags, "suggestedCollections": result.Collections, "metadata": result.Metadata, "confidence": result.Confidence, "failure": result.FailureCode})
		}
		writeJSON(w, 200, map[string]any{"results": payload, "nextSequence": next})
	}
}

func (s *SmartLibraryService) SetAssetTags() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		folderID, assetID := chi.URLParam(r, "folderID"), chi.URLParam(r, "assetID")
		var body struct {
			Tags []string `json:"tags"`
		}
		if decodeAIJSON(w, r, &body) != nil || !validOpaqueID(folderID, "slf_") || !validOpaqueID(assetID, "asset_") {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		tags, valid := normalizeEditableTags(body.Tags)
		if !valid {
			http.Error(w, "invalid tags", http.StatusBadRequest)
			return
		}
		result, err := s.database.SetSmartLibraryAssetTags(userID, folderID, assetID, tags)
		if !s.writeFolderError(w, err) {
			return
		}
		writeJSON(w, 200, map[string]any{"result": map[string]any{"assetId": result.AssetID, "status": result.Status, "assetKind": result.AssetKind, "mimeType": result.MimeType, "description": result.Description, "tags": result.Tags, "suggestedCollections": result.Collections, "metadata": result.Metadata, "confidence": result.Confidence, "failure": result.FailureCode}})
	}
}

func normalizeEditableTags(values []string) ([]string, bool) {
	if len(values) > 24 {
		return nil, false
	}
	seen := map[string]bool{}
	tags := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.Join(strings.Fields(value), " ")
		if value == "" || len(value) > 80 || utf8.RuneCountInString(value) > 40 {
			return nil, false
		}
		key := strings.ToLower(value)
		if !seen[key] {
			seen[key] = true
			tags = append(tags, value)
		}
	}
	return tags, true
}

func (s *SmartLibraryService) Rescan() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		var body struct {
			ChangedImages   int `json:"changedImages"`
			NewImages       int `json:"newImages"`
			RequestedImages int `json:"requestedImages"`
		}
		if decodeAIJSON(w, r, &body) != nil || body.ChangedImages < 0 || body.NewImages < 0 {
			http.Error(w, "invalid request", 400)
			return
		}
		folder, err := s.database.SetSmartLibraryEstimate(userID, chi.URLParam(r, "folderID"), min(body.RequestedImages, body.ChangedImages+body.NewImages, smartLibraryLimit))
		if !s.writeFolderError(w, err) {
			return
		}
		writeJSON(w, 200, map[string]any{"estimate": estimate(folder)})
	}
}

func (s *SmartLibraryService) Search() http.HandlerFunc {
	return s.searchHandler(true)
}

func (s *SmartLibraryService) GlobalSearch() http.HandlerFunc {
	return s.searchHandler(false)
}

func (s *SmartLibraryService) searchHandler(folderFromPath bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		var body struct {
			Query    string `json:"query"`
			Limit    int    `json:"limit"`
			FolderID string `json:"folderId,omitempty"`
		}
		if decodeAIJSON(w, r, &body) != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		body.Query = strings.TrimSpace(body.Query)
		if body.Query == "" || len(body.Query) > 512 || utf8.RuneCountInString(body.Query) > 256 || (body.FolderID != "" && !validOpaqueID(body.FolderID, "slf_")) {
			http.Error(w, "invalid request", 400)
			return
		}
		folderID := body.FolderID
		if folderFromPath {
			folderID = chi.URLParam(r, "folderID")
		}
		var vector []float64
		semanticAvailable := false
		if s.analyzer != nil && strings.TrimSpace(s.analyzer.APIKey) != "" && !strings.EqualFold(strings.TrimSpace(os.Getenv("SMART_LIBRARY_SEARCH_EMERGENCY_DISABLE")), "true") {
			var embedErr error
			vector, embedErr = s.cachedQueryEmbedding(r.Context(), userID, body.Query)
			if errors.Is(embedErr, errSemanticSearchRateLimited) {
				writeJSON(w, http.StatusTooManyRequests, map[string]any{"code": "semantic_search_rate_limited", "message": "Too many new semantic searches. Try again shortly."})
				return
			}
			semanticAvailable = embedErr == nil
		}
		hits, err := s.database.SearchSmartLibraryHybrid(userID, folderID, body.Query, vector, min(max(body.Limit, 1), 50))
		if !s.writeFolderError(w, err) {
			return
		}
		writeJSON(w, 200, map[string]any{"hits": hits, "queryModel": semanticModelName(s.analyzer, semanticAvailable), "indexVersion": serveragent.SmartLibraryIndexVersion, "semanticAvailable": semanticAvailable})
	}
}

func (s *SmartLibraryService) Delete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		if !s.writeFolderError(w, s.database.DeleteSmartLibraryFolder(userID, chi.URLParam(r, "folderID"))) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SmartLibraryService) IndexStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		folderID := strings.TrimSpace(r.URL.Query().Get("folderId"))
		if folderID != "" && !validOpaqueID(folderID, "slf_") {
			http.Error(w, "invalid request", 400)
			return
		}
		status, err := s.database.SmartLibraryIndexStatusForUser(userID, folderID, currentEmbeddingModel(), serveragent.SmartLibraryIndexVersion)
		if !s.writeFolderError(w, err) {
			return
		}
		writeJSON(w, 200, map[string]any{"currentVersion": status.CurrentVersion, "embeddingModel": status.EmbeddingModel, "outdatedAssets": status.OutdatedAssets, "failedAssets": status.FailedAssets, "upgradeNeeded": status.OutdatedAssets > 0})
	}
}

// PlanReindex is deliberately free: it creates durable, explicit work for the
// client to approve, but uploads nothing and invokes no model.
func (s *SmartLibraryService) PlanReindex() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		var body struct {
			FolderID      string `json:"folderId,omitempty"`
			Cursor        string `json:"cursor,omitempty"`
			Limit         int    `json:"limit,omitempty"`
			TargetVersion int    `json:"targetVersion,omitempty"`
		}
		if decodeAIJSON(w, r, &body) != nil || (body.FolderID != "" && !validOpaqueID(body.FolderID, "slf_")) || len(body.Cursor) > 200 || (body.TargetVersion != 0 && body.TargetVersion != serveragent.SmartLibraryIndexVersion) {
			http.Error(w, "invalid request", 400)
			return
		}
		if body.Limit == 0 {
			body.Limit = 100
		}
		job, err := s.database.PlanSmartLibraryReindex(userID, body.FolderID, body.Cursor, currentEmbeddingModel(), serveragent.SmartLibraryIndexVersion, body.Limit)
		if !s.writeFolderError(w, err) {
			return
		}
		assets := make([]map[string]any, 0, len(job.Assets))
		for _, asset := range job.Assets {
			assets = append(assets, map[string]any{"assetId": asset.AssetID, "folderId": asset.FolderID, "fingerprint": asset.Fingerprint, "assetKind": asset.AssetKind, "mimeType": asset.MimeType, "requiresPreview": asset.RequiresPreview})
		}
		writeJSON(w, http.StatusCreated, map[string]any{"jobId": job.ID, "status": job.Status, "targetVersion": job.Version, "embeddingModel": job.Model, "nextCursor": job.Cursor, "assets": assets, "credits": 0})
	}
}

func (s *SmartLibraryService) CompleteReindex() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		if strings.EqualFold(strings.TrimSpace(os.Getenv("SMART_LIBRARY_EMERGENCY_DISABLE")), "true") {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "smart_library_disabled", "message": "Semantic indexing is temporarily disabled. No model call was made."})
			return
		}
		if s.analyzer == nil || strings.TrimSpace(s.analyzer.APIKey) == "" {
			writeJSON(w, 503, map[string]any{"code": "smart_library_unavailable", "message": "Semantic indexing is not configured."})
			return
		}
		var body struct {
			Assets []struct {
				AssetID       string            `json:"assetId"`
				Fingerprint   string            `json:"fingerprint"`
				AssetKind     string            `json:"assetKind"`
				MimeType      string            `json:"mimeType"`
				Base64        string            `json:"base64,omitempty"`
				ExtractedText string            `json:"extractedText,omitempty"`
				Metadata      map[string]string `json:"metadata,omitempty"`
				Truncated     bool              `json:"truncated,omitempty"`
			} `json:"assets"`
		}
		if decodeSmartLibraryJSON(w, r, &body) != nil || len(body.Assets) == 0 || len(body.Assets) > smartLibraryBatchSize {
			http.Error(w, "invalid request", 400)
			return
		}
		refs := make([]db.SmartLibraryPreviewRef, 0, len(body.Assets))
		inputs := make([]serveragent.SmartLibraryAsset, 0, len(body.Assets))
		totalBytes := 0
		for _, item := range body.Assets {
			var raw []byte
			var err error
			if item.Base64 != "" {
				raw, err = base64.StdEncoding.DecodeString(item.Base64)
			}
			if item.Truncated {
				if item.Metadata == nil {
					item.Metadata = map[string]string{}
				}
				item.Metadata["contentTruncated"] = "true"
			}
			input := serveragent.SmartLibraryAsset{AssetID: item.AssetID, AssetKind: item.AssetKind, MimeType: item.MimeType, Bytes: raw, ExtractedText: item.ExtractedText, Metadata: item.Metadata}
			if err != nil || !validOpaqueID(item.AssetID, "asset_") || len(item.Fingerprint) != 64 || len(raw) > 1<<20 || serveragent.ValidateSmartLibraryAsset(input) != nil {
				http.Error(w, "invalid request", 400)
				return
			}
			totalBytes += len(raw)
			refs = append(refs, db.SmartLibraryPreviewRef{AssetID: item.AssetID, Fingerprint: item.Fingerprint, AssetKind: item.AssetKind, MimeType: item.MimeType})
			inputs = append(inputs, input)
		}
		if totalBytes > 4<<20 {
			http.Error(w, "preview batch too large", http.StatusRequestEntityTooLarge)
			return
		}
		job, records, err := s.database.SmartLibraryReindexRecords(userID, chi.URLParam(r, "jobID"), refs)
		if !s.writeFolderError(w, err) {
			return
		}
		inputByID := map[string]serveragent.SmartLibraryAsset{}
		for _, input := range inputs {
			inputByID[input.AssetID] = input
		}
		completions := map[string]db.SmartLibraryCompletion{}
		failures := map[string]string{}
		refreshByFolder := map[string][]serveragent.SmartLibraryAsset{}
		refreshNeeded := map[string]bool{}
		for _, record := range records {
			input, found := inputByID[record.AssetID]
			if !found {
				http.Error(w, "invalid claimed asset", http.StatusConflict)
				return
			}
			key := record.FolderID + "\x00" + record.AssetID
			if serveragent.SmartLibraryMetadataNeedsRefresh(agentMetadata(record)) {
				refreshNeeded[key] = true
				refreshByFolder[record.FolderID] = append(refreshByFolder[record.FolderID], input)
			}
		}
		refreshedMetadata := map[string]serveragent.SmartLibraryMetadata{}
		for folderID, refreshInputs := range refreshByFolder {
			analysis, analyzeErr := s.analyzer.Analyze(r.Context(), refreshInputs)
			model := "smart-library-metadata-refresh"
			if len(analysis.Results) > 0 && analysis.Results[0].Model != "" {
				model = analysis.Results[0].Model
			}
			success := analyzeErr == nil && len(analysis.Results) == len(refreshInputs)
			_ = s.database.RecordSmartLibrarySemanticUsage(userID, folderID, "reindex", model, len(refreshInputs), analysis.Usage.InputTokens, analysis.Usage.OutputTokens, success)
			if analyzeErr == nil {
				for _, metadata := range analysis.Results {
					refreshedMetadata[folderID+"\x00"+metadata.AssetID] = metadata
				}
			}
		}
		for _, record := range records {
			input := inputByID[record.AssetID]
			key := record.FolderID + "\x00" + record.AssetID
			metadata := agentMetadata(record)
			metadataRefreshed := refreshNeeded[key]
			if metadataRefreshed {
				var found bool
				metadata, found = refreshedMetadata[key]
				if !found {
					failures[key] = "metadata_refresh_failed"
					continue
				}
			}
			embeddings, usage, embedErr := s.analyzer.EmbedAssets(r.Context(), []serveragent.SmartLibraryAsset{input}, map[string]serveragent.SmartLibraryMetadata{input.AssetID: metadata})
			_ = s.database.RecordSmartLibrarySemanticUsage(userID, record.FolderID, "reindex", currentEmbeddingModel(), 1, usage.InputTokens, 0, embedErr == nil)
			if embedErr != nil || len(embeddings) != 1 {
				failures[key] = "embedding_failed"
				continue
			}
			completion := db.SmartLibraryCompletion{AssetID: record.AssetID, Embedding: embeddings[0].Vector, EmbeddingInputHash: embeddings[0].InputHash}
			if metadataRefreshed {
				completion.Description = metadata.Description
				completion.Tags = metadata.Tags
				completion.Collections = metadata.SuggestedCollections
				completion.Confidence = metadata.Confidence
				completion.Model = metadata.Model
				completion.FallbackReason = metadata.FallbackReason
				completion.Metadata = richMetadata(metadata)
			}
			completions[key] = completion
		}
		if len(records) > 0 {
			job, err = s.database.CompleteSmartLibraryReindexJob(userID, job.ID, completions, failures)
			if !s.writeFolderError(w, err) {
				return
			}
		}
		writeJSON(w, 200, map[string]any{"jobId": job.ID, "status": job.Status, "completedAssets": job.Completed, "failedAssets": job.Failed, "failures": failures})
	}
}

func (s *SmartLibraryService) requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, err := sessionUserID(r, s.database)
	if err != nil {
		http.Error(w, "internal error", 500)
		return "", false
	}
	if userID == "" {
		http.Error(w, "not authenticated", 401)
		return "", false
	}
	return userID, true
}
func (s *SmartLibraryService) writeFolderError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, db.ErrSmartLibraryNotFound):
		http.Error(w, "folder not found", 404)
	case errors.Is(err, db.ErrSmartLibraryLimit):
		writeJSON(w, 409, map[string]any{"code": "smart_library_limit", "message": "The 500-image pilot limit has been reached."})
	default:
		http.Error(w, "internal error", 500)
	}
	return false
}

func allowance(folder *db.SmartLibraryFolder) map[string]any {
	return map[string]any{"sampleImages": smartLibrarySampleSize, "maximumAnalyzedImages": smartLibraryLimit, "sampleIncluded": true, "remainingImages": max(0, smartLibraryLimit-folder.SuccessfulImages)}
}
func estimate(folder *db.SmartLibraryFolder) map[string]any {
	if folder == nil {
		return map[string]any{}
	}
	var price any = nil
	if raw := strings.TrimSpace(os.Getenv("SMART_LIBRARY_PRICE_MINOR_PER_IMAGE")); raw != "" {
		if unit, err := strconv.ParseInt(raw, 10, 64); err == nil && unit >= 0 {
			price = unit * int64(folder.BillableImages)
		}
	}
	return map[string]any{"eligibleImages": folder.EligibleImages, "includedImages": folder.IncludedImages, "billableImages": folder.BillableImages, "creditUnits": folder.BillableImages, "priceMinor": price, "currency": nullableCurrency(price)}
}
func nullableCurrency(price any) any {
	if price == nil {
		return nil
	}
	currency := strings.ToUpper(strings.TrimSpace(os.Getenv("SMART_LIBRARY_PRICE_CURRENCY")))
	if currency == "" {
		currency = "USD"
	}
	return currency
}
func validOpaqueID(value, prefix string) bool {
	return strings.HasPrefix(value, prefix) && len(value) <= 96 && !strings.ContainsAny(value, "/\\ \t\r\n")
}
func validAssetDescriptor(kind, mimeType string) bool {
	kind = strings.ToLower(strings.TrimSpace(kind))
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if kind == "video" || strings.HasPrefix(mimeType, "video/") {
		return false
	}
	switch kind {
	case "", "image", "document", "text", "audio", "archive", "binary":
		return true
	default:
		return false
	}
}

type smartLibraryApproval struct {
	Previews []struct {
		AssetID       string            `json:"assetId"`
		Fingerprint   string            `json:"fingerprint"`
		MimeType      string            `json:"mimeType"`
		AssetKind     string            `json:"assetKind,omitempty"`
		Base64        string            `json:"base64,omitempty"`
		ExtractedText string            `json:"extractedText,omitempty"`
		Metadata      map[string]string `json:"metadata,omitempty"`
		Truncated     bool              `json:"truncated,omitempty"`
	} `json:"previews"`
	FinalBatch              bool   `json:"finalBatch"`
	BillingMeter            string `json:"billingMeter"`
	MaximumSuccessfulImages int    `json:"maximumSuccessfulImages,omitempty"`
}

func decodeSmartLibraryJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 12<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request must contain one JSON value")
	}
	return nil
}

func min(values ...int) int {
	result := values[0]
	for _, value := range values[1:] {
		if value < result {
			result = value
		}
	}
	return result
}
func progressPayload(folder *db.SmartLibraryFolder, batches []db.SmartLibraryBatch) map[string]any {
	queued := 0
	items := make([]map[string]any, 0, len(batches))
	for _, batch := range batches {
		pending := len(batch.AssetIDs) - batch.SuccessfulImages - batch.FailedImages
		if pending > 0 {
			queued += pending
		}
		items = append(items, map[string]any{"batchId": batch.ID, "assetIds": batch.AssetIDs, "status": batch.Status, "completedImages": batch.SuccessfulImages, "failedImages": batch.FailedImages})
	}
	return map[string]any{"folderId": folder.ID, "phase": folder.State, "successfulImages": folder.SuccessfulImages, "failedImages": folder.FailedImages, "queuedImages": queued, "batches": items, "estimate": estimate(folder), "nextResultSequence": 0, "message": nil}
}

func richMetadata(value serveragent.SmartLibraryMetadata) db.SmartLibraryRichMetadata {
	return db.SmartLibraryRichMetadata{ContentType: value.ContentType, PrimarySubject: value.PrimarySubject, SearchTerms: value.SearchTerms, Entities: value.Entities, Characters: value.Characters, Brands: value.Brands, Applications: value.Applications, Objects: value.Objects, Scenes: value.Scenes, Activities: value.Activities, Colors: value.Colors, VisibleText: value.VisibleText, Topics: value.Topics}
}

func agentMetadata(value db.SmartLibraryReindexAsset) serveragent.SmartLibraryMetadata {
	return serveragent.SmartLibraryMetadata{AssetID: value.AssetID, ContentType: value.Metadata.ContentType, PrimarySubject: value.Metadata.PrimarySubject, Description: value.Description, Tags: value.Tags, SearchTerms: value.Metadata.SearchTerms, Entities: value.Metadata.Entities, Characters: value.Metadata.Characters, Brands: value.Metadata.Brands, Applications: value.Metadata.Applications, Objects: value.Metadata.Objects, Scenes: value.Metadata.Scenes, Activities: value.Metadata.Activities, Colors: value.Metadata.Colors, VisibleText: value.Metadata.VisibleText, Topics: value.Metadata.Topics, SuggestedCollections: value.Collections, Confidence: 1}
}

func currentEmbeddingModel() string {
	if value := strings.TrimSpace(os.Getenv("SMART_LIBRARY_EMBEDDING_MODEL")); value != "" {
		return value
	}
	return serveragent.SmartLibraryEmbeddingModel
}

func semanticModelName(analyzer *serveragent.SmartLibraryAnalyzer, available bool) any {
	if !available {
		return nil
	}
	return currentEmbeddingModel()
}

func (s *SmartLibraryService) cachedQueryEmbedding(ctx context.Context, userID, query string) ([]float64, error) {
	normalized := strings.ToLower(strings.Join(strings.Fields(query), " "))
	cacheKey := sha256.Sum256([]byte(userID + "\x00" + normalized))
	userKey := sha256.Sum256([]byte(userID))
	now := time.Now()
	s.searchMu.Lock()
	if cached, ok := s.queryCache[cacheKey]; ok && now.Before(cached.expires) {
		vector := append([]float64(nil), cached.vector...)
		s.searchMu.Unlock()
		return vector, nil
	}
	window := s.queryWindows[userKey]
	if window.started.IsZero() || now.Sub(window.started) >= time.Minute {
		window = semanticQueryWindow{started: now}
	}
	if window.count >= 30 {
		s.queryWindows[userKey] = window
		s.searchMu.Unlock()
		return nil, errSemanticSearchRateLimited
	}
	window.count++
	s.queryWindows[userKey] = window
	s.searchMu.Unlock()
	dailyLimit := 500
	if raw := strings.TrimSpace(os.Getenv("SMART_LIBRARY_SEARCH_DAILY_LIMIT")); raw != "" {
		if parsed, parseErr := strconv.Atoi(raw); parseErr == nil && parsed > 0 {
			dailyLimit = parsed
		}
	}
	if count, countErr := s.database.SmartLibrarySemanticCallsToday(userID, "semantic_query"); countErr == nil && count >= dailyLimit {
		return nil, errSemanticSearchRateLimited
	}
	vector, usage, err := s.analyzer.EmbedQuery(ctx, normalized)
	_ = s.database.RecordSmartLibrarySemanticUsage(userID, "", "semantic_query", currentEmbeddingModel(), 1, usage.InputTokens, 0, err == nil)
	if err != nil {
		return nil, err
	}
	s.searchMu.Lock()
	defer s.searchMu.Unlock()
	if len(s.queryCache) >= 256 {
		for key, item := range s.queryCache {
			if now.After(item.expires) {
				delete(s.queryCache, key)
			}
		}
		if len(s.queryCache) >= 256 {
			for key := range s.queryCache {
				delete(s.queryCache, key)
				break
			}
		}
	}
	s.queryCache[cacheKey] = cachedSemanticQuery{vector: append([]float64(nil), vector...), expires: now.Add(5 * time.Minute)}
	return vector, nil
}
