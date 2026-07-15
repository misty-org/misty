package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
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

const (
	mediaMaxDurationMS = int64(120 * 60 * 1000)
	mediaChunkMS       = int64(30 * 1000)
	mediaMaxFrames     = 4
	// The decoded previews are capped at 4 MiB below. Base64 adds roughly 33%,
	// so Media Search needs a narrowly scoped limit above the generic AI JSON
	// limit without increasing it for every other AI endpoint.
	mediaMaxJSONBytes = int64(6 << 20)
)

type MediaSearchService struct {
	database      *db.Database
	analyzer      *serveragent.SmartLibraryAnalyzer
	cacheMu       sync.Mutex
	queryCache    map[[32]byte]cachedSemanticQuery
	guardMu       sync.Mutex
	inFlightUsers map[string]struct{}
	inFlightTotal int
}

func NewMediaSearchService(database *db.Database, analyzer *serveragent.SmartLibraryAnalyzer) *MediaSearchService {
	return &MediaSearchService{
		database: database, analyzer: analyzer,
		queryCache:    map[[32]byte]cachedSemanticQuery{},
		inFlightUsers: map[string]struct{}{},
	}
}

type mediaIndexRequest struct {
	DeviceID      string  `json:"deviceId"`
	AssetID       string  `json:"assetId"`
	Fingerprint   string  `json:"fingerprint"`
	MediaType     string  `json:"mediaType"`
	MimeType      string  `json:"mimeType"`
	DurationMS    int64   `json:"durationMs"`
	ChunkIndex    int     `json:"chunkIndex"`
	StartMS       int64   `json:"startMs"`
	EndMS         int64   `json:"endMs"`
	AudioMimeType *string `json:"audioMimeType"`
	AudioBase64   *string `json:"audioBase64"`
	Frames        []struct {
		TimestampMS int64  `json:"timestampMs"`
		MimeType    string `json:"mimeType"`
		Base64      string `json:"base64"`
	} `json:"frames"`
}

func (s *MediaSearchService) IndexChunk() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		if strings.EqualFold(strings.TrimSpace(os.Getenv("MEDIA_SEARCH_EMERGENCY_DISABLE")), "true") {
			writeJSON(w, 503, map[string]any{"code": "media_search_disabled", "message": "Media Search is temporarily disabled. No credits were charged."})
			return
		}
		if s.analyzer == nil || strings.TrimSpace(s.analyzer.APIKey) == "" {
			writeJSON(w, 503, map[string]any{"code": "media_search_unavailable", "message": "Media Search is not configured. No credits were charged."})
			return
		}
		var body mediaIndexRequest
		if decodeAIJSONWithLimit(w, r, &body, mediaMaxJSONBytes) != nil || !validMediaIndexRequest(body) {
			http.Error(w, "invalid request", 400)
			return
		}
		var audio []byte
		var err error
		if body.AudioBase64 != nil {
			audio, err = base64.StdEncoding.DecodeString(*body.AudioBase64)
			if err != nil || len(audio) > 2<<20 || !validMP3Preview(audio) {
				http.Error(w, "invalid audio preview", 400)
				return
			}
		}
		frames := make([]serveragent.SmartLibraryAsset, 0, len(body.Frames))
		frameTimes := map[string]int64{}
		totalBytes := len(audio)
		for index, frame := range body.Frames {
			raw, decodeErr := base64.StdEncoding.DecodeString(frame.Base64)
			totalBytes += len(raw)
			id := body.AssetID + "_frame_" + strconv.Itoa(index)
			if decodeErr != nil || frame.MimeType != "image/jpeg" || len(raw) > 512<<10 || !validJPEGPreview(raw) || frame.TimestampMS < body.StartMS || frame.TimestampMS >= body.EndMS {
				http.Error(w, "invalid media frame", 400)
				return
			}
			frames = append(frames, serveragent.SmartLibraryAsset{AssetID: id, AssetKind: "image", MimeType: "image/jpeg", Bytes: raw, Metadata: map[string]string{"mediaTimestampMs": fmtInt(frame.TimestampMS)}})
			frameTimes[id] = frame.TimestampMS
		}
		if totalBytes > 4<<20 || (len(audio) == 0 && len(frames) == 0) {
			http.Error(w, "media chunk too large", http.StatusRequestEntityTooLarge)
			return
		}
		releaseProviderSlot, allowed := s.acquireProviderSlot(userID)
		if !allowed {
			w.Header().Set("Retry-After", "2")
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"code": "media_search_busy", "message": "Another media chunk is currently processing. Misty will retry it shortly.", "retry_after_seconds": 2})
			return
		}
		defer releaseProviderSlot()
		asset := db.MediaSearchAsset{DeviceID: body.DeviceID, AssetID: body.AssetID, Fingerprint: body.Fingerprint, MediaType: body.MediaType, MimeType: body.MimeType, DurationMS: body.DurationMS}
		claimed, err := s.database.ClaimMediaSearchChunk(userID, asset, body.ChunkIndex, body.StartMS, body.EndMS)
		if errors.Is(err, db.ErrMediaChunkBusy) {
			writeJSON(w, 409, map[string]any{"code": "media_chunk_processing", "message": "This media chunk is already processing."})
			return
		}
		if err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		if !claimed {
			writeJSON(w, 200, map[string]any{"status": "indexed", "alreadyIndexed": true, "chunkIndex": body.ChunkIndex})
			return
		}
		credits := max(int64(1), ((body.EndMS-body.StartMS)*db.CreditDenominationScale+59_999)/60_000)
		tier := db.TierBasic
		if license, licenseErr := s.database.GetLicenseByUserID(userID); licenseErr == nil && license != nil {
			tier = license.Tier
		}
		reservation, _, err := s.database.ReserveCredits(userID, tier, db.CreditMeterMediaSearchMinute, "media-search:"+body.DeviceID+":"+body.AssetID+":"+fmtInt(int64(body.ChunkIndex))+":"+body.Fingerprint+":"+fmtInt(time.Now().UnixNano()), credits, time.Now())
		if err != nil {
			_ = s.database.FailMediaSearchChunk(userID, body.DeviceID, body.AssetID, body.ChunkIndex, "billing_failed")
			var insufficient db.InsufficientCreditsError
			if errors.As(err, &insufficient) {
				writeJSON(w, 402, map[string]any{"code": "insufficient_credits", "message": "Not enough Mika credits to index this media.", "requiredCredits": float64(insufficient.Required) / float64(db.CreditDenominationScale), "availableCredits": float64(insufficient.Available) / float64(db.CreditDenominationScale)})
				return
			}
			http.Error(w, "internal error", 500)
			return
		}
		release := true
		defer func() {
			if release {
				_ = s.database.ReleaseCreditReservation(reservation.ID)
			}
		}()
		segments := []db.MediaSearchSegment{}
		var totalUsage serveragent.ModelUsage
		if len(audio) > 0 {
			transcript, usage, transcribeErr := s.analyzer.TranscribeMedia(r.Context(), audio, valueOr(body.AudioMimeType, "audio/mpeg"), body.EndMS-body.StartMS)
			addUsage(&totalUsage, usage)
			if transcribeErr != nil {
				_ = s.database.FailMediaSearchChunk(userID, body.DeviceID, body.AssetID, body.ChunkIndex, "transcription_failed")
				writeJSON(w, 502, map[string]any{"code": "transcription_failed", "message": "Mika could not transcribe this chunk. No credits were charged."})
				return
			}
			texts := make([]string, len(transcript))
			for i, item := range transcript {
				texts[i] = item.Text
			}
			vectors := [][]float64{}
			if len(texts) > 0 {
				var embedErr error
				vectors, usage, embedErr = embedMediaTexts(r.Context(), s.analyzer, texts)
				addUsage(&totalUsage, usage)
				if embedErr != nil {
					_ = s.database.FailMediaSearchChunk(userID, body.DeviceID, body.AssetID, body.ChunkIndex, "embedding_failed")
					writeJSON(w, 502, map[string]any{"code": "embedding_failed", "message": "Mika could not index this transcript. No credits were charged."})
					return
				}
			}
			for i, item := range transcript {
				segments = append(segments, db.MediaSearchSegment{AssetID: body.AssetID, Kind: "spoken", ChunkIndex: body.ChunkIndex, StartMS: body.StartMS + item.StartMS, EndMS: minInt64(body.EndMS, body.StartMS+item.EndMS), Content: item.Text, Transcript: item.Text, Embedding: vectors[i], EmbeddingModel: serveragent.SmartLibraryEmbeddingModel, Metadata: map[string]any{"source": "audio_transcript"}})
			}
		}
		if len(frames) > 0 {
			analysis, analyzeErr := s.analyzer.Analyze(r.Context(), frames)
			addUsage(&totalUsage, analysis.Usage)
			if analyzeErr != nil {
				_ = s.database.FailMediaSearchChunk(userID, body.DeviceID, body.AssetID, body.ChunkIndex, "visual_analysis_failed")
				writeJSON(w, 502, map[string]any{"code": "visual_analysis_failed", "message": "Mika could not analyze the scenes. No credits were charged."})
				return
			}
			metadata := map[string]serveragent.SmartLibraryMetadata{}
			for _, item := range analysis.Results {
				metadata[item.AssetID] = item
			}
			// Scene retrieval is text-to-scene search. Embed the normalized scene
			// documents as one batch after vision analysis instead of uploading each
			// frame to the embedding endpoint a second time. This is cheaper and also
			// avoids a partial per-frame embedding failure discarding the whole chunk.
			visualFrames := make([]serveragent.SmartLibraryAsset, 0, len(frames))
			visualTexts := make([]string, 0, len(frames))
			for _, frame := range frames {
				item, found := metadata[frame.AssetID]
				content := strings.TrimSpace(item.SearchDocument())
				if found && content != "" {
					visualFrames = append(visualFrames, frame)
					visualTexts = append(visualTexts, content)
				}
			}
			embeddings, usage, embedErr := embedMediaTexts(r.Context(), s.analyzer, visualTexts)
			addUsage(&totalUsage, usage)
			if embedErr != nil {
				_ = s.database.FailMediaSearchChunk(userID, body.DeviceID, body.AssetID, body.ChunkIndex, "visual_embedding_failed")
				writeJSON(w, 502, map[string]any{"code": "visual_embedding_failed", "message": "Mika could not index the scenes. No credits were charged."})
				return
			}
			byID := map[string][]float64{}
			for index, frame := range visualFrames {
				byID[frame.AssetID] = embeddings[index]
			}
			for _, frame := range visualFrames {
				item, found := metadata[frame.AssetID]
				if !found {
					continue
				}
				timestamp := frameTimes[frame.AssetID]
				visualStart, visualEnd := visualSegmentBounds(timestamp, body.EndMS)
				content := strings.TrimSpace(item.SearchDocument())
				if content == "" {
					continue
				}
				segments = append(segments, db.MediaSearchSegment{AssetID: body.AssetID, Kind: "visual", ChunkIndex: body.ChunkIndex, StartMS: visualStart, EndMS: visualEnd, Content: content, VisualDescription: item.Description, VisibleText: item.VisibleText, Embedding: byID[frame.AssetID], EmbeddingModel: serveragent.SmartLibraryEmbeddingModel, Metadata: map[string]any{"frameTimestampMs": timestamp, "primarySubject": item.PrimarySubject, "tags": item.Tags, "characters": item.Characters, "applications": item.Applications, "objects": item.Objects, "scenes": item.Scenes}})
			}
		}
		if err = s.database.CompleteMediaSearchChunk(userID, body.DeviceID, body.AssetID, body.ChunkIndex, body.EndMS, segments); err != nil {
			_ = s.database.FailMediaSearchChunk(userID, body.DeviceID, body.AssetID, body.ChunkIndex, "persistence_failed")
			http.Error(w, "internal error", 500)
			return
		}
		if _, err = s.database.SettleCreditReservation(reservation.ID, "media-search-settle:"+body.DeviceID+":"+body.AssetID+":"+fmtInt(int64(body.ChunkIndex))+":"+body.Fingerprint, db.CreditUsage{Provider: "vercel_ai_gateway", Model: "media-search-routing", InputTokens: totalUsage.InputTokens, CachedInputTokens: totalUsage.CachedInputTokens, OutputTokens: totalUsage.OutputTokens, Credits: credits}); err != nil {
			_ = s.database.FailMediaSearchChunk(userID, body.DeviceID, body.AssetID, body.ChunkIndex, "billing_settlement_failed")
			http.Error(w, "internal error", 500)
			return
		}
		release = false
		writeJSON(w, 200, map[string]any{"status": "indexed", "chunkIndex": body.ChunkIndex, "segmentCount": len(segments), "indexedThroughMs": body.EndMS, "creditsUsed": float64(credits) / float64(db.CreditDenominationScale)})
	}
}

// acquireProviderSlot bounds provider fan-out independently of the HTTP rate
// limiter. A device runs one sequential worker, but this also protects against
// multiple devices or clients racing under the same account.
func (s *MediaSearchService) acquireProviderSlot(userID string) (func(), bool) {
	s.guardMu.Lock()
	defer s.guardMu.Unlock()
	if _, busy := s.inFlightUsers[userID]; busy || s.inFlightTotal >= aiGlobalMaxConcurrent {
		return nil, false
	}
	s.inFlightUsers[userID] = struct{}{}
	s.inFlightTotal++
	return func() {
		s.guardMu.Lock()
		delete(s.inFlightUsers, userID)
		if s.inFlightTotal > 0 {
			s.inFlightTotal--
		}
		s.guardMu.Unlock()
	}, true
}

// embedMediaTexts absorbs one transient embedding failure before failing the
// customer-visible chunk. The same credit reservation covers both attempts.
func embedMediaTexts(ctx context.Context, analyzer *serveragent.SmartLibraryAnalyzer, texts []string) ([][]float64, serveragent.ModelUsage, error) {
	if len(texts) == 0 {
		return nil, serveragent.ModelUsage{}, nil
	}
	vectors, usage, err := analyzer.Embed(ctx, texts)
	if err == nil {
		return vectors, usage, nil
	}
	timer := time.NewTimer(250 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, usage, ctx.Err()
	case <-timer.C:
	}
	retried, retryUsage, retryErr := analyzer.Embed(ctx, texts)
	addUsage(&usage, retryUsage)
	if retryErr != nil {
		return nil, usage, errors.Join(err, retryErr)
	}
	return retried, usage, nil
}

func (s *MediaSearchService) Search() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		var body struct {
			DeviceID string `json:"deviceId"`
			Query    string `json:"query"`
			Limit    int    `json:"limit"`
		}
		if decodeAIJSON(w, r, &body) != nil {
			return
		}
		body.Query = strings.TrimSpace(body.Query)
		if !validMediaDeviceID(body.DeviceID) || body.Query == "" || utf8.RuneCountInString(body.Query) > 256 {
			http.Error(w, "invalid request", 400)
			return
		}
		if body.Limit == 0 {
			body.Limit = 20
		}
		vector, err := s.cachedEmbedding(r.Context(), userID, body.DeviceID, body.Query)
		if err != nil {
			vector = nil
		}
		hits, err := s.database.SearchMedia(userID, body.DeviceID, body.Query, vector, body.Limit)
		if err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		writeJSON(w, 200, map[string]any{"hits": hits})
	}
}
func (s *MediaSearchService) Status() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		deviceID := strings.TrimSpace(r.URL.Query().Get("deviceId"))
		if !validMediaDeviceID(deviceID) {
			http.Error(w, "invalid request", 400)
			return
		}
		if err := s.database.PruneIncompleteMediaSearchAssets(userID, deviceID); err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		assets, err := s.database.MediaSearchAssets(userID, deviceID)
		if err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		writeJSON(w, 200, map[string]any{"assets": assets, "maxDurationMinutes": 120, "totalDurationLimitMinutes": nil, "incompleteRetentionDays": 30})
	}
}

func (s *MediaSearchService) DeleteAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		deviceID, assetID := strings.TrimSpace(r.URL.Query().Get("deviceId")), chi.URLParam(r, "assetID")
		if !validMediaDeviceID(deviceID) || !validMediaOpaqueID(assetID) {
			http.Error(w, "invalid request", 400)
			return
		}
		deleted, err := s.database.DeleteMediaSearchAsset(userID, deviceID, assetID)
		if err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		writeJSON(w, 200, map[string]any{"deleted": deleted})
	}
}

func (s *MediaSearchService) DeleteDevice() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		deviceID := chi.URLParam(r, "deviceID")
		if !validMediaDeviceID(deviceID) {
			http.Error(w, "invalid request", 400)
			return
		}
		deleted, err := s.database.DeleteMediaSearchDevice(userID, deviceID)
		if err != nil {
			http.Error(w, "internal error", 500)
			return
		}
		writeJSON(w, 200, map[string]any{"deleted": deleted})
	}
}

func (s *MediaSearchService) AdoptLegacyDevice() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		deviceID := chi.URLParam(r, "deviceID")
		if !validMediaDeviceID(deviceID) || deviceID == db.LegacyMediaSearchDeviceID {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		ready, adopted, err := s.database.AdoptLegacyMediaSearchDevice(userID, deviceID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ready": ready, "adopted": adopted})
	}
}

func (s *MediaSearchService) cachedEmbedding(ctx context.Context, userID, deviceID, query string) ([]float64, error) {
	if s.analyzer == nil || strings.TrimSpace(s.analyzer.APIKey) == "" {
		return nil, errors.New("media semantic search is unavailable")
	}
	key := sha256.Sum256([]byte(userID + "\x00" + deviceID + "\x00" + strings.ToLower(query)))
	s.cacheMu.Lock()
	cached, found := s.queryCache[key]
	s.cacheMu.Unlock()
	if found && cached.expires.After(time.Now()) {
		return append([]float64(nil), cached.vector...), nil
	}
	vector, _, err := s.analyzer.EmbedQuery(ctx, query)
	if err != nil {
		return nil, err
	}
	s.cacheMu.Lock()
	if len(s.queryCache) > 500 {
		s.queryCache = map[[32]byte]cachedSemanticQuery{}
	}
	s.queryCache[key] = cachedSemanticQuery{vector: append([]float64(nil), vector...), expires: time.Now().Add(10 * time.Minute)}
	s.cacheMu.Unlock()
	return vector, nil
}
func (s *MediaSearchService) requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
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
func validMediaIndexRequest(v mediaIndexRequest) bool {
	if !validMediaDeviceID(v.DeviceID) || !validMediaOpaqueID(v.AssetID) || len(v.Fingerprint) != 64 || !isLowerHex(v.Fingerprint) || (v.MediaType != "audio" && v.MediaType != "video") || !strings.HasPrefix(v.MimeType, v.MediaType+"/") || v.DurationMS <= 0 || v.DurationMS > mediaMaxDurationMS || v.ChunkIndex < 0 || v.ChunkIndex >= mediaChunkCount(v.DurationMS) || v.StartMS != int64(v.ChunkIndex)*mediaChunkMS || len(v.Frames) > mediaMaxFrames {
		return false
	}
	expectedEnd := minInt64(v.DurationMS, v.StartMS+mediaChunkMS)
	if v.DurationMS-expectedEnd > 0 && v.DurationMS-expectedEnd < 5_000 {
		expectedEnd = v.DurationMS
	}
	if v.EndMS != expectedEnd {
		return false
	}
	if v.AudioBase64 != nil && (v.AudioMimeType == nil || *v.AudioMimeType != "audio/mpeg") {
		return false
	}
	if v.AudioBase64 == nil && v.AudioMimeType != nil {
		return false
	}
	if v.MediaType == "audio" && len(v.Frames) > 0 {
		return false
	}
	return true
}
func validMediaDeviceID(value string) bool {
	return len(value) == 39 && strings.HasPrefix(value, "device_") && isLowerHex(value[7:])
}
func validMediaOpaqueID(value string) bool {
	return len(value) == 38 && strings.HasPrefix(value, "media_") && isLowerHex(value[6:])
}
func mediaChunkCount(duration int64) int {
	full := duration / mediaChunkMS
	remainder := duration % mediaChunkMS
	if remainder == 0 {
		return int(full)
	}
	if remainder < 5_000 && full > 0 {
		return int(full)
	}
	return int(full + 1)
}
func isLowerHex(v string) bool {
	for _, c := range v {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func valueOr(v *string, fallback string) string {
	if v != nil && *v != "" {
		return *v
	}
	return fallback
}
func fmtInt(v int64) string { return strconv.FormatInt(v, 10) }
func addUsage(total *serveragent.ModelUsage, next serveragent.ModelUsage) {
	total.InputTokens += next.InputTokens
	total.CachedInputTokens += next.CachedInputTokens
	total.OutputTokens += next.OutputTokens
	total.ReasoningTokens += next.ReasoningTokens
}
func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
func visualSegmentBounds(timestamp, chunkEnd int64) (int64, int64) {
	return timestamp, minInt64(chunkEnd, timestamp+5_000)
}

func validJPEGPreview(raw []byte) bool {
	return len(raw) >= 4 && raw[0] == 0xff && raw[1] == 0xd8 && raw[len(raw)-2] == 0xff && raw[len(raw)-1] == 0xd9
}

func validMP3Preview(raw []byte) bool {
	return len(raw) >= 3 && (string(raw[:3]) == "ID3" || (raw[0] == 0xff && raw[1]&0xe0 == 0xe0))
}
