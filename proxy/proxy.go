package main

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/kannachi323/misty/proxy/api"
	"github.com/kannachi323/misty/proxy/api/remote"
	"github.com/kannachi323/misty/proxy/api/vault"
	"github.com/kannachi323/misty/proxy/core/ai"
	"github.com/kannachi323/misty/proxy/core/auth"
	"github.com/kannachi323/misty/proxy/core/license"
	"github.com/kannachi323/misty/proxy/core/tsbase"
	"github.com/kannachi323/misty/proxy/core/syncindex"
	"github.com/kannachi323/misty/proxy/db"
)

type Proxy struct {
	Router         *chi.Mux
	APIRouter      *chi.Mux
	TSBase         *tsbase.TSBase
	Database       *db.Database
	SyncIndex      *syncindex.Service
	LicenseManager *license.Manager
	VaultService   *vault.Service
	AIService      *ai.Service
}

func CreateProxy() (*Proxy, error) {
	home, _ := os.UserHomeDir()
	dataDir := filepath.Join(home, "misty", "minidfs", "tailscale")
	os.MkdirAll(dataDir, 0700)

	proxy := &Proxy{
		Router: chi.NewRouter(),
	}
	proxy.Router.Route("/api", func(r chi.Router) {
		proxy.APIRouter = r.(*chi.Mux)
	})

	// Serve static files
	workDir, _ := os.Getwd()
	staticDir := filepath.Join(workDir, "static")
	proxy.Router.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))
	base, err := tsbase.CreateTSBase(dataDir)
	if err != nil {
		return nil, err
	}
	proxy.TSBase = base
	proxy.Database = &db.Database{}
	proxy.LicenseManager = license.NewManager(proxy.Database)
	proxy.VaultService = vault.NewService()
	proxy.AIService = ai.NewServiceFromEnv()

	return proxy, nil
}

func (proxy *Proxy) MountHandlers() {
	proxy.APIRouter.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"https://*", "http://*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300, // Maximum value not ignored by any of major browsers
	}))

	//////--------------------------
	// DO NOT REMOVE THIS
	proxy.APIRouter.Get("/hello", api.HelloWorld())
	//////--------------------------

	// Public routes (no auth required)
	proxy.APIRouter.Post("/register", api.RegisterUser(proxy.Database))
	proxy.APIRouter.Post("/login", api.LoginUser(proxy.Database, proxy.LicenseManager))
	proxy.APIRouter.Post("/logout", api.LogoutUser(proxy.Database))
	proxy.APIRouter.Post("/refresh", api.RefreshToken(proxy.Database, proxy.LicenseManager))

	// Protected routes (JWT required)
	proxy.APIRouter.Group(func(r chi.Router) {
		r.Use(auth.JWTMiddleware)

		r.Get("/license", api.GetLicense(proxy.LicenseManager))
		r.Post("/ai/file-context", api.AskFileContext(proxy.AIService))

		r.Get("/ts-status", api.GetTSStatus(proxy.TSBase))
		r.Get("/ts-peers", api.GetPeers(proxy.TSBase))
		r.Get("/ts-ping", api.PingServer(proxy.TSBase))

		r.Get("/devices", api.GetDevices(proxy.Database))
		r.Post("/devices", api.RegisterDevice(proxy.TSBase, proxy.Database))
		r.Put("/devices", api.UpdateDevice(proxy.Database))
		r.Delete("/devices", api.DeleteDevice(proxy.Database))

		r.Get("/workspaces", api.GetWorkspaces(proxy.Database))
		r.Get("/workspace", api.GetWorkspace(proxy.Database))
		r.Post("/workspaces", api.CreateWorkspace(proxy.Database))
		r.Put("/workspaces", api.UpdateWorkspace(proxy.Database))
		r.Delete("/workspaces", api.DeleteWorkspace(proxy.Database))

		// ---- rclone unified endpoints ----
		r.Get("/remotes", remote.ListRemotes())
		r.Delete("/remotes", remote.DeleteRemote())
		r.Get("/remotes/types", remote.ListTypes())
		r.Post("/remotes/config/continue", remote.ConfigContinue())
		r.Delete("/remotes/config", remote.ConfigCancel())
		r.Get("/files", remote.ListFiles())
		r.Post("/sync/refetch", remote.SyncRefetch(proxy.SyncIndex))
		r.Get("/sync/list", remote.SyncList(proxy.SyncIndex))
		r.Get("/file/download", remote.DownloadFile())
		r.Post("/file/upload", remote.UploadFile())
		r.Post("/mkdir", remote.MkDir())
		r.Delete("/file", remote.DeleteFile())
		r.Get("/search", remote.Search())
		r.Get("/about", remote.AboutRemote())

		r.Group(func(r chi.Router) {
			r.Use(proxy.LicenseManager.RequireRemoteQuota(3, nil))
			r.Post("/remotes", remote.CreateRemote())
			r.Post("/remotes/config/start", remote.ConfigStart())
		})

		// ---- mvault (restic) endpoints ----
		v := proxy.VaultService

		r.Get("/vault/health", v.Health())
		r.Get("/vault/repos", v.ListRepos())
		r.Delete("/vault/repos", v.DeleteRepo())
		r.Get("/vault/repos/stats", v.RepoStats())
		r.Post("/vault/repos/check", v.CheckRepo())
		r.Post("/vault/repos/unlock", v.UnlockRepo())

		r.Get("/vault/snapshots", v.ListSnapshots())
		r.Get("/vault/snapshots/files", v.BrowseSnapshot())

		r.Post("/vault/restore", v.StartRestore())
		r.Post("/vault/forget", v.StartForget())

		r.Get("/vault/jobs", v.ListJobs())
		r.Get("/vault/jobs/{id}", v.GetJob())
		r.Get("/vault/jobs/{id}/stream", v.StreamJob())
		r.Post("/vault/jobs/{id}/cancel", v.CancelJob())

		r.Group(func(r chi.Router) {
			r.Use(proxy.LicenseManager.RequireVaultQuota(1, nil))
			r.Post("/vault/repos", v.CreateRepo())
			r.Post("/vault/backup", v.StartBackup())
		})
	})
}
