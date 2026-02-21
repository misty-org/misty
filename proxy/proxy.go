package main

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/kannachi323/misty/proxy/api"
	"github.com/kannachi323/misty/proxy/api/gd"
	"github.com/kannachi323/misty/proxy/api/ms"
	"github.com/kannachi323/misty/proxy/core/auth"
	"github.com/kannachi323/misty/proxy/core/tsbase"
	"github.com/kannachi323/misty/proxy/db"
)

type Proxy struct {
	Router       *chi.Mux
	APIRouter	 *chi.Mux
	TSBase		 *tsbase.TSBase
	Database     *db.Database
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
	proxy.APIRouter.Post("/login", api.LoginUser(proxy.Database))
	proxy.APIRouter.Post("/logout", api.LogoutUser())

	// OAuth callbacks must remain public
	proxy.APIRouter.Get("/ms/auth", ms.GetOAuthLogin())
	proxy.APIRouter.Get("/ms/callback", ms.OAuthCallback(proxy.Database))
	proxy.APIRouter.Get("/gd/auth", gd.GetOAuthLogin())
	proxy.APIRouter.Get("/gd/callback", gd.OAuthCallback(proxy.Database))

	// Protected routes (JWT required)
	proxy.APIRouter.Group(func(r chi.Router) {
		r.Use(auth.JWTMiddleware)

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

		// Microsoft endpoints
		r.Get("/ms/users", ms.GetMSUsers(proxy.Database))
		r.Delete("/ms/users", ms.DeleteMSToken(proxy.Database))
		r.Post("/ms/file/upload", ms.GetUploadSession(proxy.Database))
		r.Get("/ms/drive", ms.GetDrive(proxy.Database))
		r.Get("/ms/drive/root", ms.GetDriveRoot(proxy.Database))
		r.Get("/ms/files", ms.GetFiles(proxy.Database))
		r.Get("/ms/file", ms.GetFile(proxy.Database))
		r.Get("/ms/file/download", ms.DownloadFile(proxy.Database))

		// Google Drive endpoints
		r.Get("/gd/users", gd.GetGDUsers(proxy.Database))
		r.Delete("/gd/users", gd.DeleteGDToken(proxy.Database))
		r.Get("/gd/drive", gd.GetAbout(proxy.Database))
		r.Get("/gd/drive/root", gd.GetDriveRoot(proxy.Database))
		r.Get("/gd/files", gd.GetFiles(proxy.Database))
		r.Get("/gd/file", gd.GetFile(proxy.Database))
		r.Get("/gd/file/download", gd.DownloadFile(proxy.Database))
		r.Post("/gd/file/upload", gd.GetUploadSession(proxy.Database))
	})
}
