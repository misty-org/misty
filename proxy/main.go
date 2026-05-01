package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/kannachi323/misty/proxy/core/mistyconfig"
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

func main() {
	// Restore clean log output: rclone's fs/log init() has already replaced
	// the slog default with its NOTICE-prefixed handler by the time main runs.
	slog.SetDefault(slog.New(plainSlogHandler{}))

	portFlag := flag.Int("port", 0, "HTTP listen port for misty-proxy")
	flag.Parse()

	if _, err := mistyconfig.EnsureRuntimeLayout(); err != nil {
		panic(err)
	}

	cfg, _, err := mistyconfig.Load()
	if err != nil {
		panic(err)
	}
	port := *portFlag
	if port == 0 {
		port = cfg.Proxy.Port
	}
	if port == 0 {
		port = 3000
	}
	cfg.Proxy.Port = port
	if cfg.Proxy.Path == "" {
		if exe, err := os.Executable(); err == nil && exe != "" {
			cfg.Proxy.Path = exe
		}
	}
	if created, err := mistyconfig.Save(cfg); err != nil {
		panic(err)
	} else if len(created) > 0 {
		log.Println("created config", created[0])
	}
	mistyconfig.ApplyEnv(cfg)

	proxy, err := CreateProxy()
	if err != nil {
		panic(err)
	}
	proxy.Port = port

	if err := proxy.Database.StartDatabase(); err != nil {
		panic(err)
	}
	defer proxy.Database.Stop()
	proxy.SyncIndex = syncindex.NewService(proxy.Database)
	proxy.SyncManager = syncindex.NewManager(proxy.SyncIndex, 0)
	proxy.SyncManager.Start()
	log.Printf("syncindex: manager started")
	proxy.SyncPoller = syncindex.NewPoller(proxy.SyncIndex, syncindex.PollIntervalFromEnv(30))
	proxy.SyncPoller.Start()
	defer proxy.SyncPoller.Stop()
	log.Printf("syncindex: poller started")

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

	if proxy.AIService == nil || !proxy.AIService.Ready() {
		log.Println("ai: Gemini disabled; set GEMINI_API_KEY to enable file-context chat")
	} else {
		log.Println("ai: Gemini ready with model", proxy.AIService.Model())
	}

	addr := fmt.Sprintf(":%d", port)
	if err := http.ListenAndServe(addr, proxy.Router); err != nil {
		panic(err)
	}
}
