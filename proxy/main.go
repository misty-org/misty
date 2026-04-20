package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/kannachi323/misty/proxy/core/rclone"
	"github.com/kannachi323/misty/proxy/core/restic"
	"github.com/kannachi323/misty/proxy/core/syncindex"
)

// noisePatterns are substrings of log lines we never want to surface.
// Keep this list short — only for third-party chatter we can't silence at
// the source. The tsnet auth-URL banner is printed from a goroutine that
// bypasses our Logf/UserLogf hooks in some paths, so we filter by content.
var noisePatterns = []string{
	"To start this tsnet server",
}

// filterWriter wraps an io.Writer and drops any write whose payload matches
// one of the configured substrings. Used to silence known-noisy third-party
// log lines without losing our own log output.
type filterWriter struct {
	inner    io.Writer
	patterns []string
}

func (w *filterWriter) Write(p []byte) (int, error) {
	for _, pat := range w.patterns {
		if bytes.Contains(p, []byte(pat)) {
			return len(p), nil
		}
	}
	return w.inner.Write(p)
}

// plainSlogHandler writes log records as plain "YYYY/MM/DD HH:MM:SS message"
// lines to stderr, with no level prefix. We install it as the slog default to
// undo rclone's fs/log init(), which replaces the global slog default with a
// handler that decorates everything as "NOTICE: ...". Since Go's standard log
// package bridges through the slog default once SetDefault has been called,
// rclone's prefix would otherwise leak onto every log.Println in the proxy.
type plainSlogHandler struct{}

func (plainSlogHandler) Enabled(context.Context, slog.Level) bool { return true }
func (plainSlogHandler) Handle(_ context.Context, r slog.Record) error {
	for _, pat := range noisePatterns {
		if strings.Contains(r.Message, pat) {
			return nil
		}
	}
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
//  1. $HOME/misty/misty.env — the user's per-machine config, shared with
//     the desktop client (which always reads this file). Authoritative.
//  2. ../Resources/assets/misty.env relative to the executable — what the
//     bundled Misty.app ships as a seed/fallback when the user file is
//     missing. (In Misty.app, Contents/MacOS holds binaries only and
//     assets live under Contents/Resources per Apple's bundle convention.)
//  3. assets/misty.env next to the executable — for flat non-.app layouts
//     like Linux AppImage or Windows installer.
//  4. .env next to the executable — for "go build -o dist/misty-proxy ."
//     style installs.
//  5. .env in the current working directory — for `go run .` from
//     the proxy/ source dir during development.
//
// godotenv.Load does not overwrite already-set env vars, so ordering is
// "first hit wins." Anything missing is fine; the proxy falls through to
// bare os.Getenv which already handles the "no env at all" case via clear
// errors at the call sites (auth.go, license.go).
func loadEnv() string {
	var candidates []string
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, "misty", "misty.env"))
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "..", "Resources", "assets", "misty.env"),
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

	// Drop known-noisy third-party lines (e.g. tsnet's auth-URL banner that
	// loops every 5s). log.Println/Printf writes go through log.Default()'s
	// writer, so swapping it catches anything the standard log package emits.
	log.SetOutput(&filterWriter{inner: os.Stderr, patterns: noisePatterns})

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
	proxy.SyncManager = syncindex.NewManager(proxy.SyncIndex, 0)
	proxy.SyncManager.Start()
	log.Printf("syncindex: manager started")

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
	if err := rclone.EnsureAllRemoteDefaults(); err != nil {
		log.Println("rclone: ensure remote defaults:", err)
	}

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
