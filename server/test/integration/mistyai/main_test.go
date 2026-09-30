package mistyai_test

import (
	"os"
	"testing"
)

// These suites run a server without a billing adapter. The deployment default
// is hosted, which requires one, so they opt into self-hosting unless the
// environment chooses a mode. Tests covering hosted behavior set it themselves.
func TestMain(m *testing.M) {
	if _, ok := os.LookupEnv("MISTY_DEPLOYMENT_MODE"); !ok {
		os.Setenv("MISTY_DEPLOYMENT_MODE", "self_hosted")
	}
	os.Exit(m.Run())
}
