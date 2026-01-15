package main

import (
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/kannachi323/misty/proxy/api"
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
	dataDir := filepath.Join(home, ".minidfs", "tailscale")
	os.MkdirAll(dataDir, 0700)

	proxy := &Proxy{
		Router: chi.NewRouter(),
	}
	proxy.Router.Route("/api", func(r chi.Router) {
		proxy.APIRouter = r.(*chi.Mux)
	})
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

	proxy.APIRouter.Get("/ts-status", api.GetTSStatus(proxy.TSBase));
	proxy.APIRouter.Get("/ts-peers", api.GetPeers(proxy.TSBase));
	proxy.APIRouter.Get("/ts-ping", api.PingServer(proxy.TSBase))

	proxy.APIRouter.Post("/register", api.RegisterUser(proxy.Database))
	proxy.APIRouter.Post("/login", api.LoginUser(proxy.Database))

	proxy.APIRouter.Post("/file", api.CreateFile(proxy.Database))
	proxy.APIRouter.Get("/file", api.GetFile(proxy.Database))
}