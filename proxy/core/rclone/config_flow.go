package rclone

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/rc"
)

// ConfigStepKind describes how the client should render a state-machine step.
type ConfigStepKind string

const (
	ConfigStepDone    ConfigStepKind = "done"     // flow complete, remote saved
	ConfigStepChoose  ConfigStepKind = "choose"   // exclusive list — user must pick an example
	ConfigStepSuggest ConfigStepKind = "suggest"  // examples + free-text allowed
	ConfigStepConfirm ConfigStepKind = "confirm"  // yes/no question
	ConfigStepInput   ConfigStepKind = "input"    // free-text input
)

// ConfigOption is the client-facing projection of a single question.
type ConfigOption struct {
	Name     string              `json:"name"`
	Help     string              `json:"help"`
	Default  string              `json:"default"`
	Required bool                `json:"required"`
	Password bool                `json:"password"`
	Examples []ConfigOptionChoice `json:"examples,omitempty"`
}

type ConfigOptionChoice struct {
	Value string `json:"value"`
	Help  string `json:"help"`
}

// ConfigStep is what the HTTP endpoints return. The client renders the
// option using Kind, then POSTs back State + a user-supplied Result.
type ConfigStep struct {
	Name   string         `json:"name"`            // remote name this step belongs to
	State  string         `json:"state"`           // opaque — round-trip unchanged
	Kind   ConfigStepKind `json:"kind"`
	Option *ConfigOption  `json:"option,omitempty"`
	Error  string         `json:"error,omitempty"` // non-fatal warning from rclone
}

// ConfigStart begins a new remote-config flow. The first step is usually
// the backend's top-level question (after OAuth has completed transparently
// inside this call — the browser flow blocks here).
func ConfigStart(ctx context.Context, name, providerType string, params map[string]string) (*ConfigStep, error) {
	Init()

	for _, existing := range config.FileSections() {
		if existing == name {
			return nil, fmt.Errorf("remote %q already exists", name)
		}
	}

	// Point rclone's OAuth webserver at our branded callback template.
	// Ephemeral keys (config_*) can't be passed via UpdateRemoteOpt — they
	// only land in `choices`, never on the config map. The configEnvVars
	// getter reads RCLONE_CONFIG_<NAME>_<KEY> at lookup time, so an env var
	// is the supported injection point.
	if tmpl := OAuthTemplatePath(); tmpl != "" {
		envKey := fs.ConfigToEnv(name, "config_template_file")
		os.Setenv(envKey, tmpl)
		defer os.Unsetenv(envKey)
	}

	keyValues := rc.Params{}
	for k, v := range params {
		keyValues[k] = v
	}

	out, err := config.CreateRemote(ctx, name, providerType, keyValues, config.UpdateRemoteOpt{
		NonInteractive: true,
	})
	if err != nil {
		return nil, fmt.Errorf("config start: %w", err)
	}

	return advance(ctx, name, out)
}

// ConfigContinue advances the state machine using a user-supplied result.
func ConfigContinue(ctx context.Context, name, state, result string) (*ConfigStep, error) {
	Init()

	// Re-arm the OAuth template env var in case this Continue call lands on
	// the *oauth-do state (e.g. backends that defer OAuth past the first
	// question).
	if tmpl := OAuthTemplatePath(); tmpl != "" {
		envKey := fs.ConfigToEnv(name, "config_template_file")
		os.Setenv(envKey, tmpl)
		defer os.Unsetenv(envKey)
	}

	out, err := config.CreateRemote(ctx, name, "", nil, config.UpdateRemoteOpt{
		Continue:       true,
		NonInteractive: true,
		State:          state,
		Result:         result,
	})
	if err != nil {
		return nil, fmt.Errorf("config continue: %w", err)
	}

	return advance(ctx, name, out)
}

// advance walks the state machine forward, auto-answering rclone-internal
// states (anything starting with "*" — primarily the oauth-* sub-states),
// and stops when either (a) the flow is done or (b) a backend-level question
// needs the user.
//
// The blocking `*oauth-do` step runs inside this loop — that's where the
// browser flow fires. We let it block: the HTTP handler will simply sit
// until the user completes auth.
func advance(ctx context.Context, name string, out *fs.ConfigOut) (*ConfigStep, error) {
	const maxSteps = 30
	for step := 0; step < maxSteps; step++ {
		// Terminal: flow done, remote persisted. rclone signals "done" two
		// ways — either out is nil (most backends return nil,nil from their
		// final state) or out has empty state with no option/oauth.
		if out == nil || (out.State == "" && out.Option == nil && out.OAuth == nil) {
			config.SaveConfig()
			return &ConfigStep{
				Name: name,
				Kind: ConfigStepDone,
			}, nil
		}

		// User-facing question (state does NOT start with "*")
		if out.Option != nil && !strings.HasPrefix(out.State, "*") {
			return &ConfigStep{
				Name:   name,
				State:  out.State,
				Kind:   kindOf(out.Option),
				Option: projectOption(out.Option),
				Error:  out.Error,
			}, nil
		}

		// Internal state — auto-answer with default (or empty) and continue.
		result := ""
		if out.Option != nil && out.Option.Default != nil {
			result = fmt.Sprint(out.Option.Default)
		}

		next, err := config.CreateRemote(ctx, name, "", nil, config.UpdateRemoteOpt{
			Continue:       true,
			NonInteractive: true,
			State:          out.State,
			Result:         result,
		})
		if err != nil {
			return nil, fmt.Errorf("config advance (state %q): %w", out.State, err)
		}
		out = next
	}

	return nil, fmt.Errorf("config flow did not terminate within %d steps", maxSteps)
}

// kindOf classifies an Option into a render hint for the client.
func kindOf(opt *fs.Option) ConfigStepKind {
	if opt == nil {
		return ConfigStepDone
	}
	// Yes/No confirmation: boolean default + exactly the true/false examples
	if _, isBool := opt.Default.(bool); isBool &&
		opt.Exclusive && len(opt.Examples) == 2 &&
		opt.Examples[0].Value == "true" && opt.Examples[1].Value == "false" {
		return ConfigStepConfirm
	}
	if opt.Exclusive && len(opt.Examples) > 0 {
		return ConfigStepChoose
	}
	if len(opt.Examples) > 0 {
		return ConfigStepSuggest
	}
	return ConfigStepInput
}

// projectOption strips rclone-internal fields and produces a JSON-friendly shape.
func projectOption(opt *fs.Option) *ConfigOption {
	if opt == nil {
		return nil
	}
	def := ""
	if opt.Default != nil {
		def = fmt.Sprint(opt.Default)
	}
	examples := make([]ConfigOptionChoice, 0, len(opt.Examples))
	for _, ex := range opt.Examples {
		examples = append(examples, ConfigOptionChoice{
			Value: ex.Value,
			Help:  ex.Help,
		})
	}
	return &ConfigOption{
		Name:     opt.Name,
		Help:     opt.Help,
		Default:  def,
		Required: opt.Required,
		Password: opt.IsPassword,
		Examples: examples,
	}
}
