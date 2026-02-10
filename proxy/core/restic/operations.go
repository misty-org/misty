package restic

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
)

// BackupOpts controls flags passed to `restic backup`.
type BackupOpts struct {
	Tags          []string
	Excludes      []string
	Hostname      string
	ExcludeCaches bool
	OneFileSystem bool
	Compression   string // "auto" | "max" | "off"; empty = restic default
}

// Backup runs `restic backup --json` against the given paths and returns the
// final BackupSummary on success. If emit is non-nil it is called for every
// status/summary/error progress line.
//
// emit must not block — wrap it with a buffered channel or job manager if you
// need backpressure handling.
func Backup(ctx context.Context, repo RepoConfig, paths []string, opts BackupOpts, emit func(ProgressEvent)) (*BackupSummary, error) {
	if len(paths) == 0 {
		return nil, fmt.Errorf("no paths to back up")
	}

	args := []string{"backup", "--json"}
	for _, t := range opts.Tags {
		args = append(args, "--tag", t)
	}
	for _, e := range opts.Excludes {
		args = append(args, "--exclude", e)
	}
	if opts.Hostname != "" {
		args = append(args, "--host", opts.Hostname)
	}
	if opts.ExcludeCaches {
		args = append(args, "--exclude-caches")
	}
	if opts.OneFileSystem {
		args = append(args, "--one-file-system")
	}
	if opts.Compression != "" {
		args = append(args, "--compression", opts.Compression)
	}
	args = append(args, paths...)

	summary, err := runStreaming(ctx, repo, emit, args...)
	if err != nil {
		return summary, err
	}
	if summary == nil {
		return nil, fmt.Errorf("restic backup completed without emitting a summary")
	}
	return summary, nil
}

// Restore extracts a snapshot to a target directory. Progress events are
// emitted via the optional emit callback.
func Restore(ctx context.Context, repo RepoConfig, snapshotID, target string, emit func(ProgressEvent)) error {
	if snapshotID == "" {
		return fmt.Errorf("snapshot ID is required")
	}
	if target == "" {
		return fmt.Errorf("target path is required")
	}
	_, err := runStreaming(ctx, repo, emit, "restore", snapshotID, "--target", target, "--json")
	return err
}

// Ls lists files within a snapshot at the given path. Empty path returns the
// snapshot root.
func Ls(ctx context.Context, repo RepoConfig, snapshotID, path string) ([]FileNode, error) {
	if snapshotID == "" {
		return nil, fmt.Errorf("snapshot ID is required")
	}
	args := []string{"ls", "--json", snapshotID}
	if path != "" {
		args = append(args, path)
	}
	cmd, err := resticCmd(ctx, repo, args...)
	if err != nil {
		return nil, err
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("restic ls: %w", err)
	}
	// `restic ls --json` emits one JSON object per line. The first object is
	// snapshot metadata (struct_type=snapshot); subsequent objects are nodes.
	var nodes []FileNode
	scanner := bufio.NewScanner(bytes.NewReader(out))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	first := true
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		if first {
			first = false
			continue
		}
		var n FileNode
		if err := json.Unmarshal(line, &n); err != nil {
			continue
		}
		nodes = append(nodes, n)
	}
	return nodes, nil
}

// Forget applies a retention policy and (optionally) prunes the unreferenced
// data. An empty policy is rejected — that would delete every snapshot.
func Forget(ctx context.Context, repo RepoConfig, policy RetentionPolicy, prune bool) error {
	args := []string{"forget", "--json"}
	keepCount := 0
	addKeep := func(flag string, n int) {
		if n > 0 {
			args = append(args, flag, strconv.Itoa(n))
			keepCount++
		}
	}
	addKeep("--keep-last", policy.KeepLast)
	addKeep("--keep-hourly", policy.KeepHourly)
	addKeep("--keep-daily", policy.KeepDaily)
	addKeep("--keep-weekly", policy.KeepWeekly)
	addKeep("--keep-monthly", policy.KeepMonthly)
	addKeep("--keep-yearly", policy.KeepYearly)
	if keepCount == 0 {
		return fmt.Errorf("retention policy is empty; refusing to call forget")
	}
	if prune {
		args = append(args, "--prune")
	}

	cmd, err := resticCmd(ctx, repo, args...)
	if err != nil {
		return err
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("restic forget: %w (output: %s)", err, string(out))
	}
	return nil
}

// runStreaming executes a restic command that emits a stream of --json
// progress lines on stdout (backup, restore). It calls emit for every parsed
// event and returns the final BackupSummary if the stream contains one.
func runStreaming(ctx context.Context, repo RepoConfig, emit func(ProgressEvent), args ...string) (*BackupSummary, error) {
	cmd, err := resticCmd(ctx, repo, args...)
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("restic %s start: %w", args[0], err)
	}

	var summary *BackupSummary
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		ev, sum, perr := parseProgressLine(line)
		if perr != nil {
			// Restic occasionally interleaves non-JSON; skip and keep going.
			continue
		}
		if sum != nil {
			summary = sum
		}
		if ev.Type != "" && emit != nil {
			emit(ev)
		}
	}

	waitErr := cmd.Wait()
	if waitErr != nil {
		// restic exits 3 when some files couldn't be read but a snapshot was
		// still created — partial success. Surface as success if we got a
		// summary; otherwise propagate.
		if summary != nil && exitCodeIs(waitErr, 3) {
			return summary, nil
		}
		return summary, fmt.Errorf("restic %s: %w (stderr: %s)", args[0], waitErr, stderr.String())
	}
	return summary, nil
}

func exitCodeIs(err error, code int) bool {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode() == code
	}
	return false
}
