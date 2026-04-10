package rclone

import (
	"context"
	"testing"

	"github.com/rclone/rclone/fs"
)

func TestProviderNeedsFullConfig(t *testing.T) {
	if !providerNeedsFullConfig("s3") {
		t.Fatal("expected s3 to require full config")
	}
	if !providerNeedsFullConfig("sftp") {
		t.Fatal("expected sftp to require full config")
	}
	if providerNeedsFullConfig("onedrive") {
		t.Fatal("did not expect onedrive to require full config")
	}
}

func TestAdvanceReturnsQuestionForInternalAllState(t *testing.T) {
	step, err := advance(context.Background(), "s3-temp", &fs.ConfigOut{
		State: "*all-set,0,false",
		Option: &fs.Option{
			Name:     "host",
			Help:     "S3 endpoint",
			Default:  "",
			Required: true,
		},
	})
	if err != nil {
		t.Fatalf("advance returned error: %v", err)
	}
	if step == nil {
		t.Fatal("advance returned nil step")
	}
	if step.Kind != ConfigStepInput {
		t.Fatalf("expected input step, got %q", step.Kind)
	}
	if step.State != "*all-set,0,false" {
		t.Fatalf("expected state to be preserved, got %q", step.State)
	}
	if step.Option == nil || step.Option.Name != "host" {
		t.Fatal("expected host option to be returned to the client")
	}
}
