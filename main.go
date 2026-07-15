package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	server, err := CreateServer()
	if err != nil {
		panic(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		server.Telemetry.Close(ctx)
	}()
	aiProvider, aiModel := server.AIAgent.ProviderStatus()
	log.Printf("MistyAI provider: %s (%s)", aiProvider, aiModel)

	if err := server.Database.Start(); err != nil {
		panic(err)
	}
	defer server.Database.Stop()

	if err := server.MountHandlers(); err != nil {
		panic(err)
	}
	if err := server.StartRealtime(); err != nil {
		panic(err)
	}
	defer server.Realtime.Close()
	workerContext, stopWorkers := context.WithCancel(context.Background())
	defer stopWorkers()
	go runAgentRetention(workerContext, server)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Misty server running on :%s", port)
	if err := http.ListenAndServe(":"+port, server.Router); err != nil {
		panic(err)
	}
}

func runAgentRetention(ctx context.Context, server *Server) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	retentionCounter := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if serverFeatureEnabled("MISTY_FOLDER_AGENTS_ENABLED") {
				if _, err := server.Database.EnqueueDueAgentSchedules(ctx, time.Now().UTC()); err != nil {
					log.Printf("Agent schedule enqueue failed: %v", err)
				}
			}
			retentionCounter++
			if retentionCounter%10 == 0 {
				if _, err := server.PurgeExpiredAgentData(ctx, 100); err != nil {
					log.Printf("Agent attachment purge failed: %v", err)
				}
				if _, err := server.Database.PurgeExpiredAgentConversations(ctx); err != nil {
					log.Printf("Agent conversation purge failed: %v", err)
				}
				if _, err := server.Database.PurgeExpiredSpaceData(ctx); err != nil {
					log.Printf("Space retention purge failed: %v", err)
				}
			}
		}
	}
}
