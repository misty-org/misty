package rclone

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
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
	Kind   string          `json:"kind"`
	Name   string          `json:"name"`
	State  string          `json:"state"`
	Result string          `json:"result,omitempty"`
	Done   bool            `json:"done"`
	Option *ProviderOption `json:"option,omitempty"`
	Error  string          `json:"error,omitempty"`
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

func StartProviderConfig(ctx context.Context, name, providerType string, parameters map[string]string) (*ProviderStep, error) {
	return runProviderConfig(ctx, name, providerType, parameters, nil)
}

func ContinueProviderConfig(ctx context.Context, name, providerType string, parameters map[string]string, state, result string) (*ProviderStep, error) {
	return runProviderConfig(ctx, name, providerType, parameters, map[string]any{
		"continue": true,
		"state":    state,
		"result":   result,
	})
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

func newProviderStep(name string, response rcloneConfigStepResponse) *ProviderStep {
	step := &ProviderStep{
		Kind:   providerStepKind(response),
		Name:   name,
		State:  response.State,
		Result: response.Result,
		Done:   response.Option == nil && strings.TrimSpace(response.Error) == "",
		Error:  strings.TrimSpace(response.Error),
	}
	if response.Option != nil {
		option := newProviderOption(*response.Option)
		step.Option = &option
	}
	return step
}

func providerStepKind(response rcloneConfigStepResponse) string {
	if strings.TrimSpace(response.Error) != "" {
		return "error"
	}
	if response.Option == nil {
		return "done"
	}
	return "input"
}

func runProviderConfig(ctx context.Context, name, providerType string, parameters map[string]string, extraOpt map[string]any) (*ProviderStep, error) {
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
	for key, value := range extraOpt {
		opt[key] = value
	}

	var response rcloneConfigStepResponse
	if err := defaultRcloneRCD.Call(ctx, "config/create", map[string]any{
		"name":       name,
		"type":       providerType,
		"parameters": rcParameters,
		"opt":        opt,
	}, &response); err != nil {
		return nil, err
	}

	step := newProviderStep(name, response)
	if step.Error != "" {
		return step, errors.New(step.Error)
	}
	return step, nil
}
