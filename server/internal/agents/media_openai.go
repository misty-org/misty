package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/kannachi323/misty/server/internal/aimodels"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

func (a *SmartLibraryAnalyzer) transcriptionModels(ctx context.Context, primaryRole, fallbackRole, primary, fallback string) (*SmartLibraryAnalyzer, string, string, error) {
	clone := *a
	clone.roleConfigs = map[string]*aimodels.Resolved{}
	for _, role := range []string{primaryRole, fallbackRole} {
		c, err := a.roleConfig(ctx, role)
		if role == fallbackRole && errors.Is(err, aimodels.ErrDisabled) {
			fallback = ""
			continue
		}
		if err != nil {
			return nil, "", "", err
		}
		clone.roleConfigs[role] = c
		if c != nil {
			if role == primaryRole {
				primary = c.Model
			} else {
				fallback = c.Model
			}
		}
	}
	return &clone, primary, fallback, nil
}
func (a *SmartLibraryAnalyzer) transcribeRole(ctx context.Context, role string, audio []byte, mime string, duration int64, model string) ([]MediaTranscriptSegment, ModelUsage, string, int64, error) {
	configured, c, err := a.forRole(ctx, role)
	if err != nil {
		return nil, ModelUsage{}, "", 0, err
	}
	if c != nil {
		model = c.Model
	}
	if configured.callProvider != "" {
		return configured.transcribeOpenAI(ctx, audio, mime, duration, model)
	}
	return configured.transcribeMediaWithModel(ctx, audio, mime, duration, model)
}
func (a *SmartLibraryAnalyzer) transcribeOpenAI(ctx context.Context, audio []byte, mime string, duration int64, model string) (segments []MediaTranscriptSegment, usage ModelUsage, language string, actual int64, resultErr error) {
	var payload bytes.Buffer
	form := multipart.NewWriter(&payload)
	extension := "webm"
	switch strings.Split(mime, ";")[0] {
	case "audio/wav":
		extension = "wav"
	case "audio/mpeg":
		extension = "mp3"
	case "audio/mp4":
		extension = "m4a"
	case "audio/ogg":
		extension = "ogg"
	}
	file, err := form.CreateFormFile("file", "audio."+extension)
	if err != nil {
		return nil, usage, "", 0, err
	}
	_, _ = file.Write(audio)
	_ = form.WriteField("model", aimodels.NativeModel(a.callProvider, model))
	format := "json"
	if strings.HasSuffix(model, "/whisper-1") {
		format = "verbose_json"
	}
	_ = form.WriteField("response_format", format)
	_ = form.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.BaseURL, "/")+"/audio/transcriptions", &payload)
	if err != nil {
		return nil, usage, "", 0, err
	}
	if a.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+a.APIKey)
	}
	req.Header.Set("Content-Type", form.FormDataContentType())
	attempt, err := a.billing.Begin(ctx, "library.transcription", model, map[string]int64{"audio_ms": duration})
	if err != nil {
		return nil, usage, "", 0, err
	}
	success := false
	defer func() {
		if err := attempt.Finish(ctx, success, map[string]int64{"audio_ms": duration}, false); err != nil {
			resultErr = err
		}
	}()
	response, err := a.Client.Do(req)
	if err != nil {
		return nil, usage, "", 0, errors.New("transcription provider connection failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, usage, "", 0, &SpeechProviderError{Status: response.StatusCode}
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, usage, "", 0, err
	}
	var decoded struct {
		Text     string `json:"text"`
		Language string `json:"language"`
		Segments []struct {
			Start, End float64
			Text       string
		}
	}
	if json.Unmarshal(raw, &decoded) != nil {
		return nil, usage, "", 0, errors.New("invalid transcription response")
	}
	for _, s := range decoded.Segments {
		start := max(0, int64(s.Start*1000))
		end := min(duration, max(start+1, int64(s.End*1000)))
		if strings.TrimSpace(s.Text) != "" && start < duration {
			segments = append(segments, MediaTranscriptSegment{StartMS: start, EndMS: end, Text: strings.TrimSpace(s.Text)})
		}
	}
	if len(segments) == 0 && strings.TrimSpace(decoded.Text) != "" {
		segments = append(segments, MediaTranscriptSegment{StartMS: 0, EndMS: duration, Text: strings.TrimSpace(decoded.Text)})
	}
	success = true
	return segments, ModelUsage{}, decoded.Language, duration, nil
}

func (a *SmartLibraryAnalyzer) speechRequest(ctx context.Context, text, voice string) (*http.Request, *http.Client, string, bool, error) {
	configured, c, err := a.forRole(ctx, "speech")
	if err != nil {
		return nil, nil, "", false, err
	}
	model := AgentSpeechModel
	if c != nil {
		model = c.Model
	}
	a = configured
	native := a.callProvider != ""
	body := map[string]any{"text": text, "voice": voice, "outputFormat": "pcm"}
	endpoint := a.embeddingBaseURL() + "/speech-model"
	if native {
		body = map[string]any{"model": aimodels.NativeModel(a.callProvider, model), "input": text, "voice": voice, "response_format": "pcm"}
		endpoint = strings.TrimRight(a.BaseURL, "/") + "/audio/speech"
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, nil, "", false, err
	}
	if a.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+a.APIKey)
	}
	req.Header.Set("Content-Type", "application/json")
	if !native {
		req.Header.Set("ai-gateway-protocol-version", "0.0.1")
		req.Header.Set("ai-speech-model-specification-version", "4")
		req.Header.Set("ai-model-id", model)
	}
	client := a.Client
	if client == nil {
		client = defaultHTTPClient()
	}
	return req, client, model, native, nil
}

func (a *SmartLibraryAnalyzer) SpeechModel(ctx context.Context, account string) (string, error) {
	c, err := a.WithAIAccount(account).roleConfig(ctx, "speech")
	if err != nil {
		return "", err
	}
	if c != nil {
		return c.Model, nil
	}
	return AgentSpeechModel, nil
}
