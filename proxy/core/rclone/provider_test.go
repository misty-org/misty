package rclone

import (
	"testing"
	"time"
)

func TestProviderSessionSnapshotKinds(t *testing.T) {
	session := &providerSession{
		ID:           "session-1",
		Name:         "drive-work",
		CreatedAt:    time.Now(),
		kind:         providerStepBrowserAuth,
		instructions: "Sign in with your browser.",
		pollAfterMS:  defaultProviderPollAfterMS,
		result:       "pending",
	}

	step := session.snapshot()
	if step.Kind != providerStepBrowserAuth {
		t.Fatalf("initial kind = %q, want %q", step.Kind, providerStepBrowserAuth)
	}
	if step.State != "session-1" {
		t.Fatalf("initial state = %q, want session id", step.State)
	}
	if step.Result != "pending" {
		t.Fatalf("initial result = %q, want pending", step.Result)
	}

	session.applyConfigResponse(&rcloneConfigStepResponse{
		State: "teamdrive_ok",
		Option: &rcloneProviderOption{
			Name:       "config_change_team_drive",
			Help:       "Configure this as a Shared Drive?",
			DefaultStr: "false",
			Required:   false,
			Examples: []rcloneProviderExample{
				{Value: "true", Help: "Yes"},
				{Value: "false", Help: "No"},
			},
		},
	})
	step = session.snapshot()
	if step.Kind != providerStepPostAuthConfig {
		t.Fatalf("config kind = %q, want %q", step.Kind, providerStepPostAuthConfig)
	}
	if step.Option == nil {
		t.Fatal("post-auth config step should expose the returned option")
	}
	if step.Option.Name != "config_change_team_drive" {
		t.Fatalf("option name = %q, want config_change_team_drive", step.Option.Name)
	}

	session.applyConfigResponse(&rcloneConfigStepResponse{})
	step = session.snapshot()
	if step.Kind != providerStepDone {
		t.Fatalf("done kind = %q, want %q", step.Kind, providerStepDone)
	}
	if !step.Done {
		t.Fatal("done snapshot should set Done=true")
	}
	if step.Result != providerStepDone {
		t.Fatalf("done result = %q, want %q", step.Result, providerStepDone)
	}

	session.markError(assertErr("oauth failed"))
	step = session.snapshot()
	if step.Kind != providerStepError {
		t.Fatalf("error kind = %q, want %q", step.Kind, providerStepError)
	}
	if step.Error != "oauth failed" {
		t.Fatalf("error message = %q, want oauth failed", step.Error)
	}
	if step.Result != providerStepError {
		t.Fatalf("error result = %q, want %q", step.Result, providerStepError)
	}
}

func TestProviderSessionContinuationRequest(t *testing.T) {
	session := &providerSession{
		Name: "drive-work",
		kind: providerStepPostAuthConfig,
		parameters: map[string]string{
			"config_is_local": "true",
		},
		configState: "teamdrive_ok",
		option: &ProviderOption{
			Name:     "config_change_team_drive",
			Default:  "false",
			Required: false,
			Choices: []ProviderChoice{
				{Value: "true"},
				{Value: "false"},
			},
		},
	}

	params, state, answer, remoteName, err := session.continuationRequest(map[string]string{
		"config_change_team_drive": "true",
	})
	if err != nil {
		t.Fatalf("continuationRequest returned error: %v", err)
	}
	if state != "teamdrive_ok" {
		t.Fatalf("state = %q, want teamdrive_ok", state)
	}
	if answer != "true" {
		t.Fatalf("answer = %q, want true", answer)
	}
	if remoteName != "drive-work" {
		t.Fatalf("remote name = %q, want drive-work", remoteName)
	}
	if params["config_change_team_drive"] != "true" {
		t.Fatalf("merged parameter = %q, want true", params["config_change_team_drive"])
	}
}

func TestCloneStringMap(t *testing.T) {
	original := map[string]string{"a": "1"}
	cloned := cloneStringMap(original)
	cloned["a"] = "2"
	if original["a"] != "1" {
		t.Fatal("cloneStringMap should not mutate the input map")
	}
}

type assertErr string

func (e assertErr) Error() string { return string(e) }
