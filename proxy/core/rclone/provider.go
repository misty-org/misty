package rclone

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	providerStepBrowserAuth    = "browser_auth"
	providerStepPostAuthConfig = "post_auth_config"
	providerStepDone           = "done"
	providerStepError          = "error"

	defaultProviderPollAfterMS = 1000
	providerSessionTTL         = 15 * time.Minute
)

var supportedProviderTypes = map[string]struct{}{
	"drive":    {},
	"onedrive": {},
	"dropbox":  {},
}

type ProviderType struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

type ProviderChoice struct {
	Value string `json:"value"`
	Help  string `json:"help"`
}

type ProviderOption struct {
	Name     string           `json:"name"`
	Help     string           `json:"help"`
	Default  string           `json:"default"`
	Required bool             `json:"required"`
	Password bool             `json:"password"`
	Choices  []ProviderChoice `json:"choices,omitempty"`
}

type ProviderWorkflow struct {
	Type        string           `json:"type"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Options     []ProviderOption `json:"options,omitempty"`
}

type ProviderStep struct {
	Kind         string          `json:"kind"`
	Name         string          `json:"name"`
	State        string          `json:"state"`
	Result       string          `json:"result,omitempty"`
	Done         bool            `json:"done"`
	Error        string          `json:"error,omitempty"`
	AuthorizeURL string          `json:"authorize_url,omitempty"`
	Instructions string          `json:"instructions,omitempty"`
	PollAfterMS  int             `json:"poll_after_ms,omitempty"`
	Option       *ProviderOption `json:"option,omitempty"`
}

type rcloneProvidersResponse struct {
	Providers []rcloneProvider `json:"providers"`
}

type rcloneProvider struct {
	Name        string                 `json:"Name"`
	Prefix      string                 `json:"Prefix"`
	Description string                 `json:"Description"`
	Hide        bool                   `json:"Hide"`
	Options     []rcloneProviderOption `json:"Options"`
}

type rcloneProviderOption struct {
	Name       string                  `json:"Name"`
	Help       string                  `json:"Help"`
	DefaultStr string                  `json:"DefaultStr"`
	Required   bool                    `json:"Required"`
	IsPassword bool                    `json:"IsPassword"`
	Advanced   bool                    `json:"Advanced"`
	Examples   []rcloneProviderExample `json:"Examples"`
}

type rcloneProviderExample struct {
	Value string `json:"Value"`
	Help  string `json:"Help"`
}

type rcloneConfigStepResponse struct {
	Error  string                `json:"Error"`
	Option *rcloneProviderOption `json:"Option"`
	Result string                `json:"Result"`
	State  string                `json:"State"`
}

type providerSession struct {
	ID           string
	Name         string
	ProviderType string
	CreatedAt    time.Time
	FinishedAt   time.Time
	Reconnect    bool

	mu           sync.Mutex
	kind         string
	done         bool
	err          string
	authorizeURL string
	instructions string
	pollAfterMS  int
	parameters   map[string]string
	configState  string
	result       string
	option       *ProviderOption
}

func (s *providerSession) snapshot() *ProviderStep {
	s.mu.Lock()
	defer s.mu.Unlock()

	step := &ProviderStep{
		Kind:         s.kind,
		Name:         s.Name,
		State:        s.ID,
		Result:       s.result,
		Done:         s.done,
		Error:        s.err,
		AuthorizeURL: s.authorizeURL,
		Instructions: s.instructions,
		PollAfterMS:  s.pollAfterMS,
	}
	if s.option != nil {
		option := *s.option
		step.Option = &option
	}
	return step
}

func (s *providerSession) applyConfigResponse(response *rcloneConfigStepResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if response == nil {
		s.kind = providerStepError
		s.err = "provider configuration returned no response"
		s.done = false
		s.option = nil
		s.FinishedAt = time.Now()
		return
	}

	if errMsg := strings.TrimSpace(response.Error); errMsg != "" {
		s.kind = providerStepError
		s.err = errMsg
		s.done = false
		s.option = nil
		s.result = providerStepError
		s.FinishedAt = time.Now()
		return
	}

	if response.Option == nil {
		s.kind = providerStepDone
		s.done = true
		s.err = ""
		s.option = nil
		s.result = providerStepDone
		s.instructions = ""
		s.FinishedAt = time.Now()
		return
	}

	option := newProviderOption(*response.Option)
	s.kind = providerStepPostAuthConfig
	s.done = false
	s.err = ""
	s.option = &option
	s.configState = strings.TrimSpace(response.State)
	s.result = strings.TrimSpace(response.Result)
	s.instructions = "Choose how this provider should be configured before finishing setup."
	if s.parameters == nil {
		s.parameters = map[string]string{}
	}
	if _, ok := s.parameters[option.Name]; !ok {
		value := option.Default
		if value == "" && len(option.Choices) > 0 {
			value = option.Choices[0].Value
		}
		s.parameters[option.Name] = value
	}
}

func (s *providerSession) markError(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.kind = providerStepError
	s.done = false
	s.err = strings.TrimSpace(err.Error())
	s.option = nil
	s.result = providerStepError
	s.instructions = ""
	s.FinishedAt = time.Now()
}

func (s *providerSession) continuationRequest(parameters map[string]string) (map[string]string, string, string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.kind == providerStepDone || s.done {
		return nil, "", "", "", nil
	}
	if s.kind == providerStepError {
		return nil, "", "", "", fmt.Errorf("%s", s.err)
	}
	if s.kind != providerStepPostAuthConfig || s.option == nil {
		return nil, "", "", "", nil
	}

	if s.parameters == nil {
		s.parameters = map[string]string{}
	}
	for key, value := range parameters {
		s.parameters[key] = value
	}

	optionName := s.option.Name
	answer := strings.TrimSpace(s.parameters[optionName])
	if answer == "" {
		answer = strings.TrimSpace(s.option.Default)
	}
	if answer == "" && len(s.option.Choices) > 0 {
		answer = strings.TrimSpace(s.option.Choices[0].Value)
	}
	if s.option.Required && answer == "" {
		return nil, "", "", "", fmt.Errorf("%s is required", optionName)
	}

	s.parameters[optionName] = answer
	merged := cloneStringMap(s.parameters)
	return merged, s.configState, answer, s.Name, nil
}

type providerSessionStore struct {
	mu       sync.Mutex
	sessions map[string]*providerSession
}

var defaultProviderSessions = &providerSessionStore{
	sessions: map[string]*providerSession{},
}

func (s *providerSessionStore) create(name, providerType string, parameters map[string]string, reconnect bool) *providerSession {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked()

	session := &providerSession{
		ID:           uuid.New().String(),
		Name:         name,
		ProviderType: providerType,
		CreatedAt:    time.Now(),
		Reconnect:    reconnect,
		kind:         providerStepBrowserAuth,
		instructions: "Complete sign-in in the browser window opened by rclone. Misty will keep checking until the remote is ready.",
		pollAfterMS:  defaultProviderPollAfterMS,
		parameters:   cloneStringMap(parameters),
		result:       "pending",
	}
	s.sessions[session.ID] = session
	return session
}

func (s *providerSessionStore) get(id string) (*providerSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked()

	session, ok := s.sessions[strings.TrimSpace(id)]
	return session, ok
}

func (s *providerSessionStore) cleanupLocked() {
	cutoff := time.Now().Add(-providerSessionTTL)
	for id, session := range s.sessions {
		if session.CreatedAt.After(cutoff) {
			continue
		}
		session.mu.Lock()
		finished := !session.FinishedAt.IsZero()
		session.mu.Unlock()
		if finished {
			delete(s.sessions, id)
		}
	}
}

func ListProviderTypes() []ProviderType {
	workflows, err := ListProviderWorkflows(context.Background())
	if err != nil {
		return nil
	}

	types := make([]ProviderType, 0, len(workflows))
	for _, workflow := range workflows {
		types = append(types, ProviderType{
			Type: workflow.Type,
			Name: workflow.Name,
		})
	}
	return types
}

func ListProviderWorkflows(ctx context.Context) ([]ProviderWorkflow, error) {
	if err := Init(); err != nil {
		return nil, err
	}
	if err := defaultRcloneRCD.Start(); err != nil {
		return nil, err
	}

	var response rcloneProvidersResponse
	if err := defaultRcloneRCD.Call(ctx, "config/providers", map[string]any{}, &response); err != nil {
		return nil, err
	}

	workflows := make([]ProviderWorkflow, 0, len(response.Providers))
	for _, provider := range response.Providers {
		if provider.Hide || !isSupportedProvider(provider) {
			continue
		}
		workflows = append(workflows, newProviderWorkflow(provider))
	}

	sort.Slice(workflows, func(i, j int) bool {
		return workflows[i].Type < workflows[j].Type
	})

	return workflows, nil
}

func GetProviderWorkflow(ctx context.Context, providerType string) (*ProviderWorkflow, error) {
	workflows, err := ListProviderWorkflows(ctx)
	if err != nil {
		return nil, err
	}

	providerType = strings.TrimSpace(providerType)
	for _, workflow := range workflows {
		if workflow.Type == providerType {
			workflow := workflow
			return &workflow, nil
		}
	}

	return nil, fmt.Errorf("provider %q not found", providerType)
}

func StartProviderConfig(_ context.Context, name, providerType string, parameters map[string]string) (*ProviderStep, error) {
	name = strings.TrimSpace(name)
	providerType = strings.TrimSpace(providerType)

	if name == "" {
		return nil, fmt.Errorf("remote name is required")
	}
	if providerType == "" {
		return nil, fmt.Errorf("provider type is required")
	}
	if !isSupportedProviderType(providerType) {
		return nil, fmt.Errorf("provider %q is not supported", providerType)
	}
	if RemoteExists(name) {
		return nil, fmt.Errorf("remote %q already exists", name)
	}

	if err := Init(); err != nil {
		return nil, err
	}
	if err := defaultRcloneRCD.Start(); err != nil {
		return nil, err
	}

	sessionParameters := withProviderEnvDefaults(providerType, cloneStringMap(parameters))
	if strings.TrimSpace(sessionParameters["config_is_local"]) == "" {
		sessionParameters["config_is_local"] = "true"
	}

	session := defaultProviderSessions.create(name, providerType, sessionParameters, false)
	go runProviderStartSession(session)
	return session.snapshot(), nil
}

func StartProviderReconnect(_ context.Context, name string) (*ProviderStep, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("remote name is required")
	}
	if !RemoteExists(name) {
		return nil, fmt.Errorf("remote %q not found", name)
	}

	providerType := GetRemoteType(name)
	if providerType == "" {
		return nil, fmt.Errorf("remote %q has no provider type", name)
	}
	if !isSupportedProviderType(providerType) {
		return nil, fmt.Errorf("provider %q is not supported", providerType)
	}

	if err := Init(); err != nil {
		return nil, err
	}
	if err := defaultRcloneRCD.Start(); err != nil {
		return nil, err
	}

	session := defaultProviderSessions.create(name, providerType, map[string]string{}, true)
	session.instructions = "Misty is reopening the provider sign-in flow to refresh this account."
	go runProviderStartSession(session)
	return session.snapshot(), nil
}

func StartProviderRepair(ctx context.Context, name string) (*ProviderStep, error) {
	step, err := StartProviderReconnect(ctx, name)
	if err != nil {
		return nil, err
	}
	step.Instructions = "Misty is re-running the provider setup flow to repair this account."
	return step, nil
}

func ContinueProviderConfig(ctx context.Context, _, _ string, parameters map[string]string, state, _ string) (*ProviderStep, error) {
	session, ok := defaultProviderSessions.get(state)
	if !ok {
		return nil, fmt.Errorf("provider session %q not found", strings.TrimSpace(state))
	}

	requestParameters, configState, answer, remoteName, err := session.continuationRequest(parameters)
	if err != nil {
		session.markError(err)
		return session.snapshot(), nil
	}
	if requestParameters == nil {
		return session.snapshot(), nil
	}

	var (
		response *rcloneConfigStepResponse
		requestErr error
	)
	if session.Reconnect {
		response, requestErr = runProviderReconnectRequest(ctx, remoteName, requestParameters, configState, answer, true)
	} else {
		response, requestErr = runProviderConfigRequest(ctx, remoteName, session.ProviderType, requestParameters, configState, answer, true)
	}
	if requestErr != nil {
		session.markError(requestErr)
		return session.snapshot(), nil
	}

	session.applyConfigResponse(response)
	return session.snapshot(), nil
}

func runProviderStartSession(session *providerSession) {
	var (
		response *rcloneConfigStepResponse
		err error
	)
	if session.Reconnect {
		response, err = runProviderReconnectRequest(
			context.Background(),
			session.Name,
			cloneStringMap(session.parameters),
			"",
			"",
			false,
		)
	} else {
		response, err = runProviderConfigRequest(
			context.Background(),
			session.Name,
			session.ProviderType,
			cloneStringMap(session.parameters),
			"",
			"",
			false,
		)
	}
	if err != nil {
		session.markError(err)
		return
	}
	session.applyConfigResponse(response)
}

func runProviderReconnectRequest(
	ctx context.Context,
	name string,
	parameters map[string]string,
	state, result string,
	isContinue bool,
) (*rcloneConfigStepResponse, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("remote name is required")
	}

	if err := Init(); err != nil {
		return nil, err
	}
	if err := defaultRcloneRCD.Start(); err != nil {
		return nil, err
	}

	rcParameters := make(map[string]any, len(parameters))
	for key, value := range parameters {
		rcParameters[key] = value
	}

	opt := map[string]any{
		"nonInteractive": true,
	}
	if isContinue {
		opt["continue"] = true
		opt["state"] = state
		opt["result"] = result
	}

	var response rcloneConfigStepResponse
	rcd := defaultRcloneRCD
	rcd.mu.Lock()
	addr := rcd.Addr
	rcd.mu.Unlock()

	client := &http.Client{Timeout: 10 * time.Minute}
	if err := rcd.post(ctx, client, addr, "config/update", map[string]any{
		"name":       name,
		"parameters": rcParameters,
		"opt":        opt,
	}, &response); err != nil {
		return nil, err
	}

	return &response, nil
}

func newProviderWorkflow(provider rcloneProvider) ProviderWorkflow {
	workflow := ProviderWorkflow{
		Type:        providerType(provider),
		Name:        providerName(provider),
		Description: strings.TrimSpace(provider.Description),
		Options:     make([]ProviderOption, 0, len(provider.Options)),
	}

	for _, option := range provider.Options {
		if option.Advanced {
			continue
		}
		workflow.Options = append(workflow.Options, newProviderOption(option))
	}

	return workflow
}

func newProviderOption(option rcloneProviderOption) ProviderOption {
	providerOption := ProviderOption{
		Name:     strings.TrimSpace(option.Name),
		Help:     strings.TrimSpace(option.Help),
		Default:  strings.TrimSpace(option.DefaultStr),
		Required: option.Required,
		Password: option.IsPassword,
		Choices:  make([]ProviderChoice, 0, len(option.Examples)),
	}

	for _, example := range option.Examples {
		providerOption.Choices = append(providerOption.Choices, ProviderChoice{
			Value: strings.TrimSpace(example.Value),
			Help:  strings.TrimSpace(example.Help),
		})
	}

	return providerOption
}

func providerType(provider rcloneProvider) string {
	if strings.TrimSpace(provider.Prefix) != "" {
		return strings.TrimSpace(provider.Prefix)
	}
	return strings.TrimSpace(provider.Name)
}

func providerName(provider rcloneProvider) string {
	description := strings.TrimSpace(provider.Description)
	if description != "" {
		return description
	}
	return providerType(provider)
}

func isSupportedProvider(provider rcloneProvider) bool {
	_, ok := supportedProviderTypes[providerType(provider)]
	return ok
}

func isSupportedProviderType(providerType string) bool {
	_, ok := supportedProviderTypes[strings.TrimSpace(providerType)]
	return ok
}

func runProviderConfigRequest(
	ctx context.Context,
	name, providerType string,
	parameters map[string]string,
	state, result string,
	isContinue bool,
) (*rcloneConfigStepResponse, error) {
	name = strings.TrimSpace(name)
	providerType = strings.TrimSpace(providerType)
	if name == "" {
		return nil, fmt.Errorf("remote name is required")
	}
	if providerType == "" {
		return nil, fmt.Errorf("provider type is required")
	}
	if !isSupportedProviderType(providerType) {
		return nil, fmt.Errorf("provider %q is not supported", providerType)
	}

	if err := Init(); err != nil {
		return nil, err
	}
	if err := defaultRcloneRCD.Start(); err != nil {
		return nil, err
	}

	rcParameters := make(map[string]any, len(parameters))
	for key, value := range parameters {
		rcParameters[key] = value
	}

	opt := map[string]any{
		"nonInteractive": true,
	}
	if isContinue {
		opt["continue"] = true
		opt["state"] = state
		opt["result"] = result
	}

	var response rcloneConfigStepResponse
	rcd := defaultRcloneRCD
	rcd.mu.Lock()
	addr := rcd.Addr
	rcd.mu.Unlock()

	client := &http.Client{Timeout: 10 * time.Minute}
	if err := rcd.post(ctx, client, addr, "config/create", map[string]any{
		"name":       name,
		"type":       providerType,
		"parameters": rcParameters,
		"opt":        opt,
	}, &response); err != nil {
		return nil, err
	}

	return &response, nil
}

func cloneStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func withProviderEnvDefaults(providerType string, parameters map[string]string) map[string]string {
	providerType = strings.TrimSpace(providerType)
	if parameters == nil {
		parameters = map[string]string{}
	}

	applyEnvDefault := func(paramName, envName string) {
		if strings.TrimSpace(parameters[paramName]) != "" {
			return
		}
		if value := strings.TrimSpace(os.Getenv(envName)); value != "" {
			parameters[paramName] = value
		}
	}

	switch providerType {
	case "onedrive":
		applyEnvDefault("client_id", "MISTY_ONEDRIVE_CLIENT_ID")
		applyEnvDefault("client_secret", "MISTY_ONEDRIVE_CLIENT_SECRET")
		applyEnvDefault("auth_url", "MISTY_ONEDRIVE_AUTH_URL")
		applyEnvDefault("token_url", "MISTY_ONEDRIVE_TOKEN_URL")
		parameters["auth_url"] = withURLQueryValue(parameters["auth_url"], "prompt", "select_account")
	case "drive":
		applyEnvDefault("client_id", "MISTY_DRIVE_CLIENT_ID")
		applyEnvDefault("client_secret", "MISTY_DRIVE_CLIENT_SECRET")
		applyEnvDefault("auth_url", "MISTY_DRIVE_AUTH_URL")
		applyEnvDefault("token_url", "MISTY_DRIVE_TOKEN_URL")
	}

	return parameters
}

func withURLQueryValue(rawURL, key, value string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || key == "" {
		return rawURL
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}

	query := parsed.Query()
	query.Set(key, value)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}
