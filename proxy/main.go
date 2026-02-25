package main

import (
	"log"
	"net/http"
	"time"
)

func main() {
  	proxy, err := CreateProxy()
	if err != nil {
		panic(err)
	}

	if err := proxy.Database.StartDatabase(); err != nil {
		panic(err)
	}

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

	proxy.MountHandlers()
	proxy.TSBase.StartTSConnection()

	if err := http.ListenAndServe(":3000", proxy.Router); err != nil {
    	panic(err)
	}

	proxy.Database.Stop()
	
}
