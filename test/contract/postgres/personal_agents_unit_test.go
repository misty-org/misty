package db

import (
	"errors"
	"testing"

	. "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func TestNormalizePersonalAgentRequiresConcreteModel(t *testing.T) {
	tests := []struct {
		name  string
		agent PersonalAgent
		valid bool
	}{
		{
			name: "pinned model",
			agent: PersonalAgent{
				Name:      "Researcher",
				ModelMode: "pinned",
				ModelID:   "google/gemini-2.5-flash-lite",
			},
			valid: true,
		},
		{name: "missing model", agent: PersonalAgent{Name: "Researcher"}},
		{
			name: "automatic mode",
			agent: PersonalAgent{
				Name:      "Researcher",
				ModelMode: "automatic",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := TestingNormalizePersonalAgent(&test.agent)
			if test.valid && err != nil {
				t.Fatalf("normalizePersonalAgent() error = %v", err)
			}
			if !test.valid && !errors.Is(err, ErrSpaceInvalid) {
				t.Fatalf("normalizePersonalAgent() error = %v, want ErrSpaceInvalid", err)
			}
		})
	}
}
