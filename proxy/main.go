package main

import (
	"log"
	"net/http"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

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
