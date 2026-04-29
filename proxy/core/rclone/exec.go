package rclone

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

const maxRcloneErrorBytes = 8192

func rcloneCmd(ctx context.Context, args ...string) (*exec.Cmd, error) {
	if err := ensureBinaryAvailable(); err != nil {
		return nil, err
	}
	if binaryPath == "" {
		return nil, fmt.Errorf("rclone binary unavailable")
	}

	fullArgs := make([]string, 0, len(args)+4)
	fullArgs = append(fullArgs, "--config", configPath, "--log-level", "ERROR")
	fullArgs = append(fullArgs, args...)

	cmd := exec.CommandContext(ctx, binaryPath, fullArgs...)
	cmd.Env = os.Environ()
	return cmd, nil
}

func runRclone(ctx context.Context, args ...string) ([]byte, error) {
	cmd, err := rcloneCmd(ctx, args...)
	if err != nil {
		return nil, err
	}
	var stderr limitedBuffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, commandError(args, err, stderr.String())
	}
	return out, nil
}

func runRcloneWithEnv(ctx context.Context, env []string, args ...string) ([]byte, error) {
	cmd, err := rcloneCmd(ctx, args...)
	if err != nil {
		return nil, err
	}
	cmd.Env = append(cmd.Env, env...)
	var stderr limitedBuffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, commandError(args, err, stderr.String())
	}
	return out, nil
}

func streamRclone(ctx context.Context, stdout io.Writer, stdin io.Reader, args ...string) (int64, error) {
	cmd, err := rcloneCmd(ctx, args...)
	if err != nil {
		return 0, err
	}
	var stderr limitedBuffer
	counter := &countingWriter{w: stdout}
	cmd.Stdout = counter
	cmd.Stdin = stdin
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return counter.n, commandError(args, err, stderr.String())
	}
	return counter.n, nil
}

func commandError(args []string, err error, stderr string) error {
	msg := strings.TrimSpace(stderr)
	if msg == "" {
		return fmt.Errorf("rclone %s: %w", commandLabel(args), err)
	}
	return fmt.Errorf("rclone %s: %w: %s", commandLabel(args), err, msg)
}

func ensureBinaryAvailable() error {
	_ = Init()
	if binaryPath != "" {
		return nil
	}

	binaryMu.Lock()
	defer binaryMu.Unlock()
	if binaryPath != "" {
		return nil
	}

	path, err := findRcloneBinary()
	if err != nil {
		binaryError = err
		return err
	}
	binaryPath = path

	out, err := exec.Command(binaryPath, "version").Output()
	if err != nil {
		binaryError = fmt.Errorf("rclone version: %w", err)
		return binaryError
	}
	binaryVersion = parseRcloneVersion(string(out))
	binaryError = nil
	return nil
}

func commandLabel(args []string) string {
	if len(args) == 0 {
		return ""
	}
	if len(args) == 1 {
		return args[0]
	}
	return args[0] + " " + args[1]
}

type countingWriter struct {
	w io.Writer
	n int64
}

func (cw *countingWriter) Write(p []byte) (int, error) {
	n, err := cw.w.Write(p)
	cw.n += int64(n)
	return n, err
}

type limitedBuffer struct {
	buf bytes.Buffer
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	remaining := maxRcloneErrorBytes - b.buf.Len()
	if remaining > 0 {
		if len(p) > remaining {
			_, _ = b.buf.Write(p[:remaining])
		} else {
			_, _ = b.buf.Write(p)
		}
	}
	return len(p), nil
}

func (b *limitedBuffer) String() string {
	return b.buf.String()
}
