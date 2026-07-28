package main

import "testing"

func disableJournalCollabForTest(t *testing.T) {
	t.Helper()
	t.Setenv("MISTY_JOURNAL_COLLAB_ENABLED", "false")
}
