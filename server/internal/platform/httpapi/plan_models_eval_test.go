package api

import "testing"

func TestEvalTurnLimitOnlyInDevelopmentWithModelChoice(t *testing.T) {
	t.Setenv("MISTY_ENVIRONMENT", "production")
	t.Setenv("MISTY_ALLOW_MODEL_OVERRIDE", "1")
	if got := evalTurnLimit(90, 20); got != 20 {
		t.Fatalf("production honored an eval turn limit: %d", got)
	}
	t.Setenv("MISTY_ENVIRONMENT", "development")
	if got := evalTurnLimit(90, 20); got != 90 {
		t.Fatalf("development eval limit = %d", got)
	}
	if got := evalTurnLimit(500, 20); got != 120 {
		t.Fatalf("eval limit not capped: %d", got)
	}
	if got := evalTurnLimit(0, 20); got != 20 {
		t.Fatalf("absent eval limit changed the plan's: %d", got)
	}
}
