package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/kannachi323/misty/proxy/core/rclone"
	"github.com/kannachi323/misty/proxy/core/restic"
	"github.com/kannachi323/misty/proxy/core/setup"
	"github.com/kannachi323/misty/proxy/core/syncindex"
)

func main() {
	proxy, listener := startProxy()
	defer cleanup(proxy, listener)

	rclone.Init()
	_ = rclone.EnsureAllRemoteDefaults()
	_ = restic.Init()

	proxy.MountHandlers()
	log.Println("PROXY: started on port", proxy.Port)
	if err := http.Serve(listener, proxy.Router); err != nil {
		panic(err)
	}

}

func startProxy() (*Proxy, net.Listener) {
	cfg := loadProxyConfig()
	listener, port := bindProxyListener(cfg.Proxy.Port)
	persistRuntimeConfig(&cfg, port)

	proxy := createProxy(cfg)
	startDatabase(proxy)
	startBackgroundJobs(proxy)
	startSyncServices(proxy)
	proxy.Port = port
	return proxy, listener
}

func loadProxyConfig() setup.Config {
	if err := setup.EnsureSetup(); err != nil {
		panic(err)
	}

	cfg, _, err := setup.Load()
	if err != nil {
		panic(err)
	}
	return cfg
}

func bindProxyListener(startPort int) (net.Listener, int) {
	listener, port, err := confirmPort(startPort, 21)
	if err != nil {
		panic(err)
	}
	return listener, port
}

func persistRuntimeConfig(cfg *setup.Config, port int) {
	cfg.Proxy.Port = port
	if _, err := setup.Save(*cfg); err != nil {
		panic(err)
	}
}

func createProxy(cfg setup.Config) *Proxy {
	proxy, err := CreateProxy(cfg)
	if err != nil {
		panic(err)
	}
	return proxy
}

func startDatabase(proxy *Proxy) {
	if err := proxy.Database.StartDatabase(); err != nil {
		panic(err)
	}
}

func startBackgroundJobs(proxy *Proxy) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			_ = proxy.Database.CleanupExpiredRefreshTokens()
		}
	}()
}

func startSyncServices(proxy *Proxy) {
	proxy.SyncIndex = syncindex.NewService(proxy.Database)
	proxy.SyncManager = syncindex.NewManager(proxy.SyncIndex, 0)
	proxy.SyncManager.Start()
	proxy.SyncPoller = syncindex.NewPoller(proxy.SyncIndex, syncindex.PollIntervalFromEnv(30))
	proxy.SyncPoller.Start()
}

func confirmPort(startPort, maxTries int) (net.Listener, int, error) {
	var lastErr error
	for i := 0; i < maxTries; i++ {
		port := startPort + i
		listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err == nil {
			return listener, port, nil
		}
		lastErr = err
	}
	return nil, 0, fmt.Errorf("listen on proxy port range %d-%d: %w", startPort, startPort+maxTries-1, lastErr)
}

func cleanup(proxy *Proxy, listener net.Listener) {
	proxy.Database.Stop()
	listener.Close()
	proxy.SyncPoller.Stop()
	proxy.SyncManager.Stop()
}
