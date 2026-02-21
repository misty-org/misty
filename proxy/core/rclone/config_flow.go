package rclone

import (
	"context"
	"fmt"
)

// ConfigStepKind describes how the client should render a state-machine step.
type ConfigStepKind string

const (
	ConfigStepDone    ConfigStepKind = "done"
	ConfigStepChoose  ConfigStepKind = "choose"
	ConfigStepSuggest ConfigStepKind = "suggest"
	ConfigStepConfirm ConfigStepKind = "confirm"
	ConfigStepInput   ConfigStepKind = "input"
)

type ConfigOption struct {
	Name     string               `json:"name"`
	Help     string               `json:"help"`
	Default  string               `json:"default"`
	Required bool                 `json:"required"`
	Password bool                 `json:"password"`
	Examples []ConfigOptionChoice `json:"examples,omitempty"`
}

type ConfigOptionChoice struct {
	Value string `json:"value"`
	Help  string `json:"help"`
}

type ConfigStep struct {
	Name   string         `json:"name"`
	State  string         `json:"state"`
	Kind   ConfigStepKind `json:"kind"`
	Option *ConfigOption  `json:"option,omitempty"`
	Error  string         `json:"error,omitempty"`
}

// ConfigStart preserves the existing client endpoint while delegating setup
// to the external rclone binary. The embedded rclone library exposed an
// in-process question state machine; external rclone does not, so this call
// runs rclone's own config create flow and returns done when it succeeds.
func ConfigStart(ctx context.Context, name, providerType string, params map[string]string) (*ConfigStep, error) {
	if err := CreateRemote(ctx, name, providerType, params); err != nil {
		return nil, fmt.Errorf("config start: %w", err)
	}
	finalName := FinalizeRemoteName(ctx, name)
	return &ConfigStep{
		Name: finalName,
		Kind: ConfigStepDone,
	}, nil
}

func ConfigContinue(context.Context, string, string, string) (*ConfigStep, error) {
	return nil, fmt.Errorf("external rclone config flow does not support additional in-app steps")
}

func providerNeedsFullConfig(providerType string) bool {
	switch providerType {
	case "s3", "sftp":
		return true
	default:
		return false
	}
}
