package db

import (
	"testing"
	"time"
)

func TestAgentScheduleDueCoalescesMissedIntervals(t *testing.T) {
	baseline := time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC)
	if !agentScheduleDue("0 9 * * 1-5", baseline, time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)) {
		t.Fatal("missed weekday schedule was not due")
	}
	if agentScheduleDue("0 9 * * 1-5", baseline, time.Date(2026, 7, 14, 8, 30, 0, 0, time.UTC)) {
		t.Fatal("future weekday schedule was due early")
	}
	if agentScheduleDue("not cron", baseline, time.Now()) {
		t.Fatal("invalid cron expression was accepted")
	}
}
