package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
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
	go runLibraryPeopleProcessing(workerContext, server)
	go runLibraryRenditionProcessing(workerContext, server)
	go runLibraryIntelligenceProcessing(workerContext, server)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Misty server running on :%s", port)
	if err := runHTTPServer(newHTTPServer(":"+port, server.Router), stopWorkers); err != nil {
		panic(err)
	}
	log.Println("Misty server stopped")
}

func runLibraryIntelligenceProcessing(ctx context.Context, server *Server) {
	if server.Library == nil {
		return
	}
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	workerID := "intelligence-worker-" + uuid.NewString()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := server.Library.ProcessIntelligenceJobs(ctx, workerID, 2); err != nil {
				log.Printf("Library intelligence processing failed: %v", err)
			}
		}
	}
}

func runLibraryRenditionProcessing(ctx context.Context, server *Server) {
	if server.Library == nil {
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	workerID := "rendition-worker-" + uuid.NewString()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := server.Library.ProcessRenditionJobs(ctx, workerID, 2); err != nil {
				log.Printf("Library rendition processing failed: %v", err)
			}
		}
	}
}

func runLibraryPeopleProcessing(ctx context.Context, server *Server) {
	if server.Library == nil {
		return
	}
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	workerID := "people-worker-" + uuid.NewString()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := server.Library.ProcessPeopleJobs(ctx, workerID, 4); err != nil {
				log.Printf("Library People processing failed: %v", err)
			}
		}
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
			if _, err := server.CleanupExpiredLibraryData(ctx, 100); err != nil {
				log.Printf("Library reservation cleanup failed: %v", err)
			}
			if server.Library != nil {
				if _, err := server.Database.ReleaseExpiredLibraryRenditionReservations(ctx, 100); err != nil {
					log.Printf("Library rendition reservation cleanup failed: %v", err)
				}
				if _, err := server.Library.PurgeExpiredRenditions(ctx, 20); err != nil {
					log.Printf("Library rendition purge failed: %v", err)
				}
			}
			if server.Spaces != nil {
				if _, err := server.Spaces.ProcessDueAgentWorkflows(ctx, time.Now().UTC(), 100); err != nil {
					log.Printf("Agent workflow schedule processing failed: %v", err)
				}
			}
			retentionCounter++
			if retentionCounter%10 == 0 {
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
