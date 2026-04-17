package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/joho/godotenv"
	"github.com/kannachi323/misty/proxy/core/rclone"
	"github.com/kannachi323/misty/proxy/core/restic"
	"github.com/kannachi323/misty/proxy/core/syncindex"
)

// plainSlogHandler writes log records as plain "YYYY/MM/DD HH:MM:SS message"
// lines to stderr, with no level prefix. We install it as the slog default to
// undo rclone's fs/log init(), which replaces the global slog default with a
// handler that decorates everything as "NOTICE: ...". Since Go's standard log
// package bridges through the slog default once SetDefault has been called,
// rclone's prefix would otherwise leak onto every log.Println in the proxy.
type plainSlogHandler struct{}

func (plainSlogHandler) Enabled(context.Context, slog.Level) bool { return true }
func (plainSlogHandler) Handle(_ context.Context, r slog.Record) error {
	t := r.Time
	if t.IsZero() {
		t = time.Now()
	}
	fmt.Fprintf(os.Stderr, "%s %s\n", t.Format("2006/01/02 15:04:05"), r.Message)
	return nil
}
func (h plainSlogHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h plainSlogHandler) WithGroup(string) slog.Handler      { return h }

// loadEnv tries each candidate location in order and returns the first
// path that successfully loaded. The lookup is deterministic regardless of
// the proxy's working directory:
//
//  1. assets/misty.env next to the executable — what the bundled
//     desktop app (Misty.app, Windows installer, Linux AppImage) ships.
//  2. .env next to the executable — for "go build -o dist/misty-proxy ."
//     style installs.
//  3. .env in the current working directory — for `go run .` from
//     the proxy/ source dir during development.
//
// Anything missing is fine; the proxy falls through to bare os.Getenv
// which already handles the "no env at all" case via clear errors at the
// call sites (auth.go, license.go).
func loadEnv() string {
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "assets", "misty.env"),
			filepath.Join(dir, ".env"),
		)
	}
	candidates = append(candidates, ".env")

	for _, p := range candidates {
		if err := godotenv.Load(p); err == nil {
			return p
		}
	}
	return ""
}

func main() {
	// Restore clean log output: rclone's fs/log init() has already replaced
	// the slog default with its NOTICE-prefixed handler by the time main runs.
	slog.SetDefault(slog.New(plainSlogHandler{}))

	if loaded := loadEnv(); loaded != "" {
		log.Println("env loaded from", loaded)
	} else {
		log.Println("no .env file found, using process environment")
	}

	proxy, err := CreateProxy()
	if err != nil {
		panic(err)
	}

	if err := proxy.Database.StartDatabase(); err != nil {
		panic(err)
	}
	proxy.SyncIndex = syncindex.NewService(proxy.Database)

	// Periodically clean up expired/revoked refresh tokens
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := proxy.Database.CleanupExpiredRefreshTokens(); err != nil {
				log.Println("Refresh token cleanup error:", err)
			}
		}
	}()

	rclone.Init()

	// MVault depends on the restic binary being on PATH and meeting the
	// minimum version. We do the check at startup so misconfigured installs
	// fail loudly here instead of at first vault API call. Vault routes are
	// still mounted regardless — they'll surface the same error per-request
	// to the C++ client, which is what the UI expects to display.
	if err := restic.Init(); err != nil {
		log.Println("vault: restic unavailable, vault routes will return errors:", err)
	} else if hp := restic.HelperBinaryPath(); hp == "" {
		log.Println("vault: misty-pwd-helper not found; falling back to file-stored passwords (set MISTY_PWD_HELPER or place the binary next to misty-proxy to enable keyring storage)")
	} else {
		log.Println("vault: restic ready, helper binary at", hp)
	}

	proxy.MountHandlers()
	proxy.TSBase.StartTSConnection()

	if proxy.AIService == nil || !proxy.AIService.Ready() {
		log.Println("ai: Gemini disabled; set GEMINI_API_KEY to enable file-context chat")
	} else {
		log.Println("ai: Gemini ready with model", proxy.AIService.Model())
	}

	if err := http.ListenAndServe(":3000", proxy.Router); err != nil {
		panic(err)
	}

	proxy.Database.Stop()

}
