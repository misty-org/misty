package main

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/kannachi323/misty/proxy/api"
	"github.com/kannachi323/misty/proxy/api/remote"
	searchapi "github.com/kannachi323/misty/proxy/api/search"
	"github.com/kannachi323/misty/proxy/api/vault"
	"github.com/kannachi323/misty/proxy/core/setup"
	"github.com/kannachi323/misty/proxy/core/syncindex"
	"github.com/kannachi323/misty/proxy/db"
	_ "github.com/kannachi323/misty/proxy/docs"
	authmw "github.com/kannachi323/misty/proxy/middleware"
	"github.com/kannachi323/misty/proxy/routes"
	httpSwagger "github.com/swaggo/http-swagger/v2"
)

type Proxy struct {
	Router       *chi.Mux
	APIRouter    *chi.Mux
	Port         int
	ServerURL    string
	Database     *db.Database
	SyncIndex    *syncindex.Service
	SyncManager  *syncindex.Manager
	SyncPoller   *syncindex.Poller
	VaultService *vault.Service
}

func CreateProxy(cfg setup.Config) (*Proxy, error) {
	proxy := &Proxy{
		Router:    chi.NewRouter(),
		ServerURL: cfg.Server.URL,
	}
	proxy.Router.Route("/api", func(r chi.Router) {
		proxy.APIRouter = r.(*chi.Mux)
	})

	// Serve static files
	workDir, _ := os.Getwd()
	staticDir := filepath.Join(workDir, "static")
	proxy.Router.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))
	proxy.Router.Get("/docs/*", httpSwagger.Handler(
		httpSwagger.URL("/docs/doc.json"),
	))
	proxy.Database = &db.Database{}
	proxy.VaultService = vault.NewService()

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
	proxy.APIRouter.Get(routes.RemoteBasePath+"/health", remote.Health())
	proxy.APIRouter.Get(routes.LegacyRemoteBasePath+"/health", remote.Health())
	//////--------------------------

	// Public routes (no auth required)
	proxy.APIRouter.Post("/register", api.RegisterUser(proxy.Database, proxy.ServerURL))
	proxy.APIRouter.Post("/login", api.LoginUser(proxy.Database, proxy.ServerURL))
	proxy.APIRouter.Post("/logout", api.LogoutUser(proxy.Database))
	proxy.APIRouter.Post("/refresh", api.RefreshToken(proxy.Database))
	proxy.APIRouter.Get("/health", api.Health())
	proxy.APIRouter.Post("/search", searchapi.Search())

	// Protected routes (JWT required)
	proxy.APIRouter.Group(func(r chi.Router) {
		r.Use(authmw.JWTMiddleware(proxy.Database))

		// ---- rclone provider endpoints ----
		mountRemoteRoutes(r, routes.RemoteBasePath)
		mountRemoteRoutes(r, routes.LegacyRemoteBasePath)

		// vault
		v := proxy.VaultService

		r.Get("/vault/health", v.Health())
		r.Get("/vault/repos", v.ListRepos())
		r.Post("/vault/repos", v.CreateRepo())
		r.Delete("/vault/repos", v.DeleteRepo())
		r.Get("/vault/repos/stats", v.RepoStats())
		r.Post("/vault/repos/check", v.CheckRepo())
		r.Post("/vault/repos/unlock", v.UnlockRepo())

		r.Get("/vault/snapshots", v.ListSnapshots())
		r.Get("/vault/snapshots/files", v.BrowseSnapshot())

		r.Post("/vault/backup", v.StartBackup())
		r.Post("/vault/restore", v.StartRestore())
		r.Post("/vault/forget", v.StartForget())

		r.Get("/vault/jobs", v.ListJobs())
		r.Get("/vault/jobs/{id}", v.GetJob())
		r.Get("/vault/jobs/{id}/stream", v.StreamJob())
		r.Post("/vault/jobs/{id}/cancel", v.CancelJob())

	})
}

func mountRemoteRoutes(r chi.Router, base string) {
	r.Get(base, remote.ListRemotes())
	r.Delete(base, remote.DeleteRemote())
	r.Get(base+"/types", remote.ListTypes())
	r.Get(base+"/workflows", remote.ListProviderWorkflows())
	r.Get(base+"/workflow", remote.GetProviderWorkflow())
	r.Post(base+"/config/start", remote.ConfigStart())
	r.Post(base+"/config/continue", remote.ConfigContinue())
	r.Get(base+"/health", remote.Health())
	r.Get(base+"/file/list", remote.ListFiles())
	r.Get(base+"/file/download", remote.DownloadFile())
	r.Post(base+"/file/upload", remote.UploadFile())
	r.Delete(base+"/file", remote.DeleteFile())
	r.Post(base+"/file/rename", remote.RenameFile())
}
