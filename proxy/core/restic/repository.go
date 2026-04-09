package restic

import (
	"context"
	"encoding/json"
	"fmt"
)

// InitRepo initializes a new restic repository at repo.URL using the given
// password. The password is stored via StorePassword (keyring when the
// helper binary is available, file fallback otherwise) so subsequent
// operations on this repo can locate it.
func InitRepo(ctx context.Context, repo RepoConfig, password string) error {
	if err := Init(); err != nil {
		return err
	}
	if err := StorePassword(repo.Name, password); err != nil {
		return fmt.Errorf("store password: %w", err)
	}
	cmd, err := resticCmd(ctx, repo, "init", "--json")
	if err != nil {
		return err
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("restic init: %w (output: %s)", err, string(out))
	}
	return nil
}

// Snapshots returns the list of snapshots in the given repository.
func Snapshots(ctx context.Context, repo RepoConfig) ([]Snapshot, error) {
	cmd, err := resticCmd(ctx, repo, "snapshots", "--json")
	if err != nil {
		return nil, err
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("restic snapshots: %w", err)
	}
	var snaps []Snapshot
	if err := json.Unmarshal(out, &snaps); err != nil {
		return nil, fmt.Errorf("parse snapshots json: %w", err)
	}
	return snaps, nil
}

// CheckRepo verifies repository integrity. With readData=true it also reads
// every pack file (slow — only do this on a schedule).
func CheckRepo(ctx context.Context, repo RepoConfig, readData bool) error {
	args := []string{"check"}
	if readData {
		args = append(args, "--read-data")
	}
	cmd, err := resticCmd(ctx, repo, args...)
	if err != nil {
		return err
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("restic check: %w (output: %s)", err, string(out))
	}
	return nil
}

// RepoStats returns size statistics about the repository.
func RepoStats(ctx context.Context, repo RepoConfig) (*RepoStatsResult, error) {
	cmd, err := resticCmd(ctx, repo, "stats", "--json", "--mode", "raw-data")
	if err != nil {
		return nil, err
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("restic stats: %w", err)
	}
	var s RepoStatsResult
	if err := json.Unmarshal(out, &s); err != nil {
		return nil, fmt.Errorf("parse stats json: %w", err)
	}
	return &s, nil
}

// Unlock removes stale repo locks. Safe to call when no operation is running.
func Unlock(ctx context.Context, repo RepoConfig) error {
	cmd, err := resticCmd(ctx, repo, "unlock")
	if err != nil {
		return err
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("restic unlock: %w (output: %s)", err, string(out))
	}
	return nil
}
