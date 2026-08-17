package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	agent "github.com/kannachi323/misty/server/internal/agents"
	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
)

// The desktop runs Midscene's screen loop for a browser.act job and sends its
// model calls here. Misty keeps the gateway key, admits each call against the
// run's model-turn budget and meters it to the run. Inference happens at the
// gateway; this only forwards.
const (
	screenActTool        = "browser.act"
	screenModelBodyLimit = 12 << 20
	screenModelMaxOutput = 2200
	screenModelMaxCalls  = 40
)

// ScreenModel forwards one OpenAI-style chat completion for a live act job.
func (s *SpacesService) ScreenModel() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.appsUser(w, r)
		if !ok {
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		job, err := s.database.WorkflowDeviceNodeJob(r.Context(), user, chi.URLParam(r, "jobID"))
		if err != nil || job.Operation != screenActTool || (job.State != "leased" && job.State != "executing") || time.Now().After(job.DeadlineAt) {
			writeJSON(w, http.StatusForbidden, map[string]string{"code": "screen_act_inactive", "message": "This screen task is no longer running."})
			return
		}
		call, err := strconv.Atoi(r.URL.Query().Get("call"))
		if err != nil || call < 0 || call >= screenModelMaxCalls {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "screen_model_call_limit", "message": "This screen task used all of its model calls."})
			return
		}
		var body struct {
			Messages json.RawMessage `json:"messages"`
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, screenModelBodyLimit+1))
		if err != nil || len(raw) > screenModelBodyLimit || json.Unmarshal(raw, &body) != nil || len(body.Messages) < 2 || body.Messages[0] != '[' {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "screen_model_invalid", "message": "Invalid screen model request."})
			return
		}
		record, err := s.database.AIInvocationByID(r.Context(), user, job.RunID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		node := "screen:" + job.ID + ":" + strconv.Itoa(call)
		if err := s.meterAIInvocationRuntimeModel(r.Context(), record, node, "running", mustJSONRaw(map[string]any{"input_bytes": len(raw)})); err != nil {
			writeJSON(w, http.StatusPaymentRequired, map[string]string{"code": "screen_model_budget", "message": "The task's model allowance is used up."})
			return
		}
		response, usage, err := forwardScreenModel(r.Context(), aiInvocationMeteredModel(record), body.Messages)
		completion := map[string]any{"usage": map[string]any{"inputTokens": usage.PromptTokens, "outputTokens": usage.CompletionTokens}}
		if err != nil {
			completion = map[string]any{}
		}
		_ = s.meterAIInvocationRuntimeModel(context.WithoutCancel(r.Context()), record, node, "completed", mustJSONRaw(completion))
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"code": "screen_model_failed", "message": "The screen model could not answer. Try again."})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}
}

type screenModelUsage struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
}

// forwardScreenModel calls the gateway's OpenAI-compatible endpoint with the
// run's model. The client cannot choose the model or raise the output limit.
func forwardScreenModel(ctx context.Context, model string, messages json.RawMessage) (json.RawMessage, screenModelUsage, error) {
	var usage screenModelUsage
	key := strings.TrimSpace(envconfig.Getenv("AI_GATEWAY_API_KEY"))
	base := strings.TrimSpace(envconfig.Getenv("AI_GATEWAY_BASE_URL"))
	if base == "" {
		base = agent.TestingDefaultVercelAIBaseURL
	}
	if key == "" {
		return nil, usage, errScreenModelUnconfigured
	}
	payload, err := json.Marshal(map[string]any{"model": model, "messages": messages, "max_tokens": screenModelMaxOutput, "temperature": 0, "stream": false})
	if err != nil {
		return nil, usage, err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, usage, err
	}
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, usage, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, usage, err
	}
	if response.StatusCode/100 != 2 {
		return nil, usage, &screenModelError{status: response.StatusCode}
	}
	var decoded struct {
		Usage screenModelUsage `json:"usage"`
	}
	if json.Unmarshal(body, &decoded) != nil {
		return nil, usage, &screenModelError{status: response.StatusCode}
	}
	return body, decoded.Usage, nil
}

var errScreenModelUnconfigured = errors.New("screen model gateway is not configured")

type screenModelError struct{ status int }

func (e *screenModelError) Error() string {
	return "screen model gateway status " + strconv.Itoa(e.status)
}
