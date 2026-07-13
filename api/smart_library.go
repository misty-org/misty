package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
)

const (
	smartLibrarySampleSize = 25
	smartLibraryLimit      = 500
	smartLibraryBatchSize  = 8
)

type SmartLibraryService struct {
	database *db.Database
	analyzer *serveragent.SmartLibraryAnalyzer
}

func NewSmartLibraryService(database *db.Database, analyzers ...*serveragent.SmartLibraryAnalyzer) *SmartLibraryService {
	service := &SmartLibraryService{database: database}
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
			if !validOpaqueID(candidate.AssetID, "asset_") || len(candidate.Fingerprint) != 64 || candidate.SizeBytes < 0 {
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
		images := make([]serveragent.SmartLibraryImage, 0, len(body.Previews))
		totalBytes := 0
		for _, preview := range body.Previews {
			raw, err := base64.StdEncoding.DecodeString(preview.Base64)
			if err != nil || !validOpaqueID(preview.AssetID, "asset_") || len(preview.Fingerprint) != 64 || preview.MimeType != "image/jpeg" || len(raw) < 1 || len(raw) > 1<<20 {
				http.Error(w, "invalid request", 400)
				return
			}
			totalBytes += len(raw)
			refs = append(refs, db.SmartLibraryPreviewRef{AssetID: preview.AssetID, Fingerprint: preview.Fingerprint})
			images = append(images, serveragent.SmartLibraryImage{AssetID: preview.AssetID, MimeType: preview.MimeType, Bytes: raw})
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
			reservation, _, err = s.database.ReserveCredits(userID, tier, db.CreditMeterAssetAnalysisImage, "smart-library:"+batch.ID, int64(len(images))*db.CreditDenominationScale, time.Now())
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
		analysis, analysisErr := s.analyzer.Analyze(r.Context(), images)
		failures := analysis.Failures
		if failures == nil {
			failures = map[string]string{}
		}
		resolved := map[string]bool{}
		completions := make([]db.SmartLibraryCompletion, 0, len(analysis.Results))
		for _, result := range analysis.Results {
			resolved[result.AssetID] = true
			delete(failures, result.AssetID)
			completions = append(completions, db.SmartLibraryCompletion{AssetID: result.AssetID, Description: result.Description, Tags: result.Tags, Collections: result.SuggestedCollections, Confidence: result.Confidence, Model: result.Model, FallbackReason: result.FallbackReason})
		}
		for id := range failures {
			resolved[id] = true
		}
		for _, image := range images {
			if !resolved[image.AssetID] {
				code := "analysis_failed"
				if analysisErr != nil {
					code = "provider_failed"
				}
				failures[image.AssetID] = code
			}
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
		folder, err := s.database.SmartLibraryFolder(userID, chi.URLParam(r, "folderID"))
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
		payload["phase"] = phase
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
			payload = append(payload, map[string]any{"assetId": result.AssetID, "status": result.Status, "description": result.Description, "tags": result.Tags, "suggestedCollections": result.Collections, "confidence": result.Confidence, "failure": result.FailureCode})
		}
		writeJSON(w, 200, map[string]any{"results": payload, "nextSequence": next})
	}
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
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.requireUser(w, r); !ok {
			return
		}
		var body struct {
			Query string `json:"query"`
			Limit int    `json:"limit"`
		}
		if decodeAIJSON(w, r, &body) != nil || len(body.Query) > 500 {
			http.Error(w, "invalid request", 400)
			return
		}
		hits, err := s.database.SearchSmartLibrary(userID, chi.URLParam(r, "folderID"), strings.TrimSpace(body.Query), min(max(body.Limit, 1), 50))
		if !s.writeFolderError(w, err) {
			return
		}
		writeJSON(w, 200, map[string]any{"hits": hits})
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

type smartLibraryApproval struct {
	Previews []struct {
		AssetID     string `json:"assetId"`
		Fingerprint string `json:"fingerprint"`
		MimeType    string `json:"mimeType"`
		Base64      string `json:"base64"`
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
