package api

import (
	"context"
	"crypto/rand"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	agent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/aimodels"
	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"io"
	"net/http"
	"strings"
)

func (s *SpacesService) aiProvidersUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	user, err := sessionUserID(r, s.database)
	if err != nil || user == "" {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return "", false
	}
	if db.AppAuthorityFromContext(r.Context()) != nil {
		http.Error(w, "account settings require the signed-in user", http.StatusForbidden)
		return "", false
	}
	return user, true
}
func (s *SpacesService) aiKeyAAD(user, id, provider string) []byte {
	return []byte("misty-ai-provider-v1:" + user + ":" + id + ":" + provider)
}
func (s *SpacesService) encryptAIKey(user, id, provider, key string) ([]byte, []byte, error) {
	if s.aead == nil {
		return nil, nil, errors.New("credential storage unavailable")
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return s.aead.Seal(nil, nonce, []byte(key), s.aiKeyAAD(user, id, provider)), nonce, nil
}
func (s *SpacesService) decryptAIKey(user string, c *db.AIProviderConnection) (string, error) {
	if s.aead == nil || len(c.Nonce) != s.aead.NonceSize() {
		return "", errors.New("provider credential unavailable")
	}
	key, err := s.aead.Open(nil, c.Nonce, c.Ciphertext, s.aiKeyAAD(user, c.ID, c.Provider))
	if err != nil {
		return "", errors.New("provider credential unavailable")
	}
	return string(key), nil
}
func writeAIProviderError(w http.ResponseWriter, err error) {
	status, message := http.StatusInternalServerError, "Could not save provider settings. Try again."
	switch {
	case errors.Is(err, db.ErrSpaceNotFound):
		status, message = http.StatusNotFound, "This connection is unavailable. Choose another connection."
	case errors.Is(err, db.ErrAIConnectionInUse):
		status, message = http.StatusConflict, err.Error()
	case errors.Is(err, db.ErrSpaceInvalid):
		status, message = http.StatusBadRequest, "Check the connection, model ID and reasoning choices."
	case errors.Is(err, aimodels.ErrDisabled):
		status, message = http.StatusConflict, err.Error()
	}
	writeJSON(w, status, map[string]string{"code": "ai_provider_settings_error", "message": message})
}
func (s *SpacesService) AIProviderSettings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.aiProvidersUser(w, r)
		if !ok {
			return
		}
		connections, err := s.database.AIProviderConnections(r.Context(), user)
		if err != nil {
			writeAIProviderError(w, err)
			return
		}
		routes, err := s.database.AIModelRoutes(r.Context(), user)
		if err != nil {
			writeAIProviderError(w, err)
			return
		}
		defaults := defaultAIRoutes("", "")
		writeJSON(w, http.StatusOK, map[string]any{"connections": connections, "routes": routes, "roles": aimodels.Roles, "defaults": defaults})
	}
}
func (s *SpacesService) AIProviderConnections() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.aiProvidersUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "connectionID")
		if r.Method == http.MethodDelete {
			writeErr := s.database.RevokeAIProviderConnection(r.Context(), user, id)
			if writeErr != nil {
				writeAIProviderError(w, writeErr)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var body struct {
			Name     string `json:"name"`
			Provider string `json:"provider"`
			BaseURL  string `json:"base_url"`
			APIKey   string `json:"api_key"`
		}
		if TestingDecodeAIJSONWithLimit(w, r, &body, 32<<10) != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		body.Name = strings.TrimSpace(body.Name)
		body.APIKey = strings.TrimSpace(body.APIKey)
		body.BaseURL = strings.TrimRight(strings.TrimSpace(body.BaseURL), "/")
		validKey := true
		for _, ch := range body.APIKey {
			if ch < 33 || ch > 126 {
				validKey = false
				break
			}
		}
		if len(body.APIKey) > 16<<10 || !validKey {
			writeAIProviderError(w, db.ErrSpaceInvalid)
			return
		}
		if r.Method == http.MethodPut {
			c, err := s.database.AIProviderConnection(r.Context(), user, id)
			if err != nil {
				writeAIProviderError(w, err)
				return
			}
			if body.APIKey == "" && c.Provider != "openai-compatible" {
				writeAIProviderError(w, db.ErrSpaceInvalid)
				return
			}
			ciphertext, nonce, err := s.encryptAIKey(user, c.ID, c.Provider, body.APIKey)
			if err == nil {
				err = s.database.RotateAIProviderKey(r.Context(), user, id, ciphertext, nonce)
			}
			if err != nil {
				writeAIProviderError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		supported := body.Provider == "gateway" || body.Provider == "openai" || body.Provider == "anthropic" || body.Provider == "google" || body.Provider == "openai-compatible"
		if !supported || body.Name == "" || len([]rune(body.Name)) > 80 || (body.APIKey == "" && body.Provider != "openai-compatible") {
			writeAIProviderError(w, db.ErrSpaceInvalid)
			return
		}
		if body.BaseURL == "" {
			body.BaseURL = aimodels.DefaultBase(body.Provider)
		}
		if err := aimodels.ValidateBase(body.BaseURL); err != nil {
			writeJSON(w, 400, map[string]string{"code": "invalid_endpoint", "message": err.Error()})
			return
		}
		c := db.AIProviderConnection{ID: "aip_" + uuid.NewString(), Name: body.Name, Provider: body.Provider, BaseURL: body.BaseURL}
		ciphertext, nonce, err := s.encryptAIKey(user, c.ID, c.Provider, body.APIKey)
		c.Ciphertext, c.Nonce = ciphertext, nonce
		if err == nil {
			err = s.database.CreateAIProviderConnection(r.Context(), user, c)
		}
		if err != nil {
			writeAIProviderError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, c)
	}
}
func (s *SpacesService) AIModelRoutes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.aiProvidersUser(w, r)
		if !ok {
			return
		}
		var body struct {
			Routes []aimodels.Route `json:"routes"`
		}
		if TestingDecodeAIJSONWithLimit(w, r, &body, 32<<10) != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		if err := s.database.SaveAIModelRoutes(r.Context(), user, body.Routes); err != nil {
			writeAIProviderError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func defaultAIRoutes(model, reasoning string) []aimodels.Route {
	if model == "" {
		model = agent.FrontierDefaultModelID()
	}
	if reasoning == "" {
		reasoning = "low"
	}
	defaults := map[string]string{"agent": model, "vision": model, "routing": envOr("MISTY_AI_LOW_MODEL", agent.TestingDefaultAgentLowGatewayModel), "realtime": agent.RealtimeModelID(), "library": envOr("SMART_LIBRARY_PRIMARY_MODEL", agent.SmartLibraryPrimaryModel), "library-fallback": envOr("SMART_LIBRARY_FALLBACK_MODEL", agent.SmartLibraryFallbackModel), "embedding": envOr("SMART_LIBRARY_EMBEDDING_MODEL", agent.SmartLibraryEmbeddingModel), "transcription": envOr("AGENT_TRANSCRIPTION_MODEL", "openai/gpt-4o-mini-transcribe"), "transcription-fallback": agent.MediaSearchTranscriptionFallbackModel, "media-transcription": envOr("MEDIA_SEARCH_TRANSCRIPTION_MODEL", agent.MediaSearchTranscriptionModel), "media-transcription-fallback": envOr("MEDIA_SEARCH_TRANSCRIPTION_FALLBACK_MODEL", agent.MediaSearchTranscriptionFallbackModel), "speech": agent.AgentSpeechModel}
	if config, err := envconfig.AgentModel(); err == nil && config.Provider == "openai" {
		defaults["routing"] = config.Model
	}
	result := make([]aimodels.Route, 0, len(aimodels.Roles))
	for _, role := range aimodels.Roles {
		effort := ""
		if role.Reasoning {
			effort = "low"
		}
		if role.ID == "agent" {
			effort = reasoning
		}
		result = append(result, aimodels.Route{Role: role.ID, Model: defaults[role.ID], Reasoning: effort, Enabled: true})
	}
	return result
}
func envOr(key, fallback string) string {
	if v := strings.TrimSpace(envconfig.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func (s *SpacesService) resolveAIRoute(ctx context.Context, user string, r aimodels.Route) (*aimodels.Resolved, error) {
	if !r.Enabled {
		return nil, aimodels.ErrDisabled
	}
	if r.ConnectionID == "" {
		return nil, nil
	}
	c, err := s.database.AIProviderConnection(ctx, user, r.ConnectionID)
	if err != nil {
		return nil, err
	}
	if !aimodels.Supports(r.Role, c.Provider) {
		return nil, db.ErrSpaceInvalid
	}
	key, err := s.decryptAIKey(user, c)
	if err != nil {
		return nil, err
	}
	return &aimodels.Resolved{Provider: c.Provider, Model: r.Model, Reasoning: r.Reasoning, BaseURL: c.BaseURL, APIKey: key}, nil
}
func (s *SpacesService) ResolveAIModel(ctx context.Context, user, role string) (*aimodels.Resolved, error) {
	routes, err := s.database.AIModelRoutes(ctx, user)
	if err != nil {
		return nil, err
	}
	for _, r := range routes {
		if r.Role == role {
			return s.resolveAIRoute(ctx, user, r)
		}
	}
	return nil, nil
}

func (s *SpacesService) AgentRuntimeModelProvider() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RuntimeRunID string `json:"runtime_run_id"`
			Role         string `json:"role"`
			Model        string `json:"model"`
		}
		if !readAgentRuntimeRequest(s.agentRuntime, w, r, &body) {
			return
		}
		runID := chi.URLParam(r, "runID")
		user := ""
		if body.Role != "agent" && body.Role != "vision" {
			writeAIProviderError(w, db.ErrSpaceForbidden)
			return
		}
		if isAIInvocationRuntimeID(runID) {
			record, err := s.database.ValidateAIInvocationRuntime(r.Context(), runID, body.RuntimeRunID)
			if err != nil {
				writeAgentError(w, err)
				return
			}
			user = record.UserID
			runID = record.ID
		} else {
			run, _, err := s.database.ValidatePersonalAgentTaskRuntime(r.Context(), runID, body.RuntimeRunID)
			if err != nil {
				writeAgentError(w, err)
				return
			}
			user = run.OwnerUserID
			runID = run.ID
		}
		route, err := s.database.AIModelRunRoute(r.Context(), user, runID, body.Role)
		if err != nil || route.Model != body.Model {
			writeJSON(w, 409, map[string]string{"code": "model_route_changed", "message": "The requested model does not match the admitted task."})
			return
		}
		config, err := s.resolveAIRoute(r.Context(), user, route)
		if err != nil {
			writeAIProviderError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if config == nil {
			writeJSON(w, 200, map[string]any{"provider": "instance", "reasoning": route.Reasoning})
			return
		}
		// Internal HMAC-authenticated call made inside the SDK model step only.
		writeJSON(w, 200, map[string]any{"provider": config.Provider, "model": config.Model, "baseURL": config.BaseURL, "apiKey": config.APIKey, "reasoning": config.Reasoning})
	}
}

func modelRoute(routes []aimodels.Route, role string) aimodels.Route {
	for _, r := range routes {
		if r.Role == role {
			return r
		}
	}
	return aimodels.Route{Role: role, Enabled: true}
}

func (s *AIService) accountAgentModel(ctx context.Context, user string) (string, string, bool, error) {
	if s.providerSettings == nil {
		return "", "", false, nil
	}
	routes, err := s.database.AIModelRoutes(ctx, user)
	if err != nil {
		return "", "", false, err
	}
	for _, r := range routes {
		if r.Role == "agent" {
			if !r.Enabled {
				return "", "", false, aimodels.ErrDisabled
			}
			if r.Model != "" {
				return r.Model, r.Reasoning, true, nil
			}
		}
	}
	return "", "", false, nil
}

func (s *SpacesService) runtimeModelBilling(ctx context.Context, user, run, node, fallback string) (string, string, error) {
	role := "agent"
	if db.ScreenPlanningNode(node) {
		role = "vision"
	}
	r, err := s.database.AIModelRunRoute(ctx, user, run, role)
	if err != nil {
		return "", "", err
	}
	if !r.Enabled {
		return "", "", aimodels.ErrDisabled
	}
	provider := agentRuntimeUsageProvider()
	if r.ConnectionID != "" {
		c, err := s.database.AIProviderConnection(ctx, user, r.ConnectionID)
		if err != nil {
			return "", "", err
		}
		provider = c.Provider
		if provider == "gateway" {
			provider = "ai-gateway"
		}
	}
	if r.Model == "" {
		r.Model = fallback
	}
	return provider, r.Model, nil
}

func configuredEmbeddingModel(ctx context.Context, analyzer *agent.SmartLibraryAnalyzer, user string) string {
	if analyzer == nil {
		return envOr("SMART_LIBRARY_EMBEDDING_MODEL", agent.SmartLibraryEmbeddingModel)
	}
	model, err := analyzer.WithAIAccount(user).AccountEmbeddingModel(ctx)
	if err != nil {
		return ""
	}
	return model
}
