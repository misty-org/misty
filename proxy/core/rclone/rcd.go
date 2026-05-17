package rclone

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type RcloneRCD struct {
	BinaryPath string
	ConfigPath string
	Client     *http.Client
	Addr       string
	Running    atomic.Bool

	err error
	mu  sync.Mutex
	cmd *exec.Cmd
}

func (rcd *RcloneRCD) Call(ctx context.Context, path string, input any, output any) error {
	if !rcd.Running.Load() {
		return fmt.Errorf("rclone rcd is not running")
	}

	rcd.mu.Lock()
	addr := rcd.Addr
	client := rcd.Client
	rcd.mu.Unlock()

	return rcd.post(ctx, client, addr, path, input, output)
}

func (rcd *RcloneRCD) Start() error {
	rcd.mu.Lock()
	defer rcd.mu.Unlock()

	if rcd.Running.Load() {
		return nil
	}
	if err := rcd.rcdRequirements(); err != nil {
		rcd.err = err
		return err
	}
	cmd, err := rcd.newCommand()
	if err != nil {
		rcd.err = err
		return err
	}

	rcd.cmd = cmd
	rcd.err = nil
	rcd.Running.Store(true)

	rcd.watchCommand(cmd) // background watcher to monitor command termination

	return nil
}

func (rcd *RcloneRCD) Stop() error {
	rcd.mu.Lock()
	defer rcd.mu.Unlock()

	if rcd.cmd == nil || rcd.cmd.Process == nil {
		rcd.Running.Store(false)
		return nil
	}

	err := rcd.cmd.Process.Kill()
	rcd.cmd = nil
	rcd.Running.Store(false)
	return err
}

func (rcd *RcloneRCD) rcdRequirements() error {
	if rcd.BinaryPath == "" {
		return fmt.Errorf("rclone binary path is required")
	}
	if rcd.ConfigPath == "" {
		return fmt.Errorf("rclone config path is required")
	}
	if rcd.Client == nil {
		rcd.Client = &http.Client{Timeout: 10 * time.Second}
	}
	if rcd.Addr == "" {
		rcd.Addr = "127.0.0.1:5572"
	}
	return nil
}

func (rcd *RcloneRCD) newCommand() (*exec.Cmd, error) {
	cmd := exec.Command(rcd.BinaryPath,
		"rcd", "--rc-addr", rcd.Addr, "--config", rcd.ConfigPath,
		"--rc-no-auth",
	)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start rclone rcd: %w", err)
	}
	return cmd, nil
}

func (rcd *RcloneRCD) watchCommand(cmd *exec.Cmd) {
	go func() {
		err := cmd.Wait()
		rcd.mu.Lock()
		defer rcd.mu.Unlock()
		if rcd.cmd == cmd {
			rcd.cmd = nil
			rcd.err = err
			rcd.Running.Store(false)
		}
	}()
}

func (rcd *RcloneRCD) post(ctx context.Context, client *http.Client, addr, path string, input any, output any) error {
	if ctx == nil {
		ctx = context.Background()
	}

	req, err := rcd.newPostRequest(ctx, addr, path, input)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("call rclone rc %s: %w", path, err)
	}
	defer resp.Body.Close()

	payload, err := rcd.readResponseBody(resp)
	if err != nil {
		return err
	}

	return rcd.decodeResponse(path, resp, payload, output)
}

func (rcd *RcloneRCD) StreamCommand(ctx context.Context, out io.Writer, command string, args ...string) (int64, error) {
	if !rcd.Running.Load() {
		return 0, fmt.Errorf("rclone rcd is not running")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	rcd.mu.Lock()
	addr := rcd.Addr
	client := rcd.Client
	rcd.mu.Unlock()

	req, err := rcd.newPostRequest(ctx, addr, "core/command", map[string]any{
		"command":    command,
		"arg":        args,
		"returnType": "STREAM",
	})
	if err != nil {
		return 0, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("call rclone rc core/command: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		payload, readErr := rcd.readResponseBody(resp)
		if readErr != nil {
			return 0, readErr
		}
		return 0, fmt.Errorf("rclone rc core/command returned %s: %s", resp.Status, strings.TrimSpace(string(payload)))
	}

	n, err := io.Copy(out, resp.Body)
	if err != nil {
		return n, fmt.Errorf("stream rclone rc core/command: %w", err)
	}
	return n, nil
}

func (rcd *RcloneRCD) UploadFile(ctx context.Context, fs, remote, fileName string, in io.Reader) error {
	if !rcd.Running.Load() {
		return fmt.Errorf("rclone rcd is not running")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	rcd.mu.Lock()
	addr := rcd.Addr
	client := rcd.Client
	rcd.mu.Unlock()

	req, err := rcd.newUploadRequest(ctx, addr, fs, remote, fileName, in)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("call rclone rc operations/uploadfile: %w", err)
	}
	defer resp.Body.Close()

	payload, err := rcd.readResponseBody(resp)
	if err != nil {
		return err
	}
	return rcd.decodeResponse("operations/uploadfile", resp, payload, nil)
}

// setup the post request with the given context, address, path, and input
func (rcd *RcloneRCD) newPostRequest(ctx context.Context, addr, path string, input any) (*http.Request, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("marshal rc request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://"+addr+"/"+strings.TrimPrefix(path, "/"),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("build rc request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func (rcd *RcloneRCD) newUploadRequest(ctx context.Context, addr, fs, remote, fileName string, in io.Reader) (*http.Request, error) {
	bodyReader, contentType := rcd.newUploadBody(fileName, in)

	u := url.URL{
		Scheme: "http",
		Host:   addr,
		Path:   "/operations/uploadfile",
	}
	query := u.Query()
	query.Set("fs", fs)
	query.Set("remote", remote)
	u.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bodyReader)
	if err != nil {
		return nil, fmt.Errorf("build rc upload request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	return req, nil
}

func (rcd *RcloneRCD) newUploadBody(fileName string, in io.Reader) (io.Reader, string) {
	pipeReader, pipeWriter := io.Pipe()
	writer := multipart.NewWriter(pipeWriter)

	go func() {
		defer pipeWriter.Close()

		part, err := writer.CreateFormFile("file", fileName)
		if err != nil {
			_ = pipeWriter.CloseWithError(err)
			return
		}
		if _, err := io.Copy(part, in); err != nil {
			_ = pipeWriter.CloseWithError(err)
			return
		}
		if err := writer.Close(); err != nil {
			_ = pipeWriter.CloseWithError(err)
			return
		}
	}()

	return pipeReader, writer.FormDataContentType()
}

// read the response body and return it as a byte slice
func (rcd *RcloneRCD) readResponseBody(resp *http.Response) ([]byte, error) {
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read rc response: %w", err)
	}
	return payload, nil
}

// decode the response body into the output object
func (rcd *RcloneRCD) decodeResponse(path string, resp *http.Response, payload []byte, output any) error {
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("rclone rc %s returned %s: %s", path, resp.Status, strings.TrimSpace(string(payload)))
	}
	if output == nil || len(payload) == 0 {
		return nil
	}
	if err := json.Unmarshal(payload, output); err != nil {
		return fmt.Errorf("decode rc response: %w", err)
	}
	return nil
}
