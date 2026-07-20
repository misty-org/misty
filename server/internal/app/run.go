package app

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	envconfig "github.com/kannachi323/misty/server/internal/platform/config"

	"github.com/google/uuid"
)

func Run() {
	runtimeConfig := envconfig.LoadRuntime()

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
	startWorkers(
		workerContext,
		WorkerFunc(func(ctx context.Context) { runBillingCompletions(ctx, server) }),
		WorkerFunc(func(ctx context.Context) { runAgentRetention(ctx, server) }),
		WorkerFunc(func(ctx context.Context) { runPersonalAgentTaskProcessing(ctx, server) }),
		WorkerFunc(func(ctx context.Context) { runLibraryPeopleProcessing(ctx, server) }),
		WorkerFunc(func(ctx context.Context) { runLibraryRenditionProcessing(ctx, server) }),
		WorkerFunc(func(ctx context.Context) { runLibraryIntelligenceProcessing(ctx, server) }),
		WorkerFunc(func(ctx context.Context) { runNoteControlProcessing(ctx, server) }),
		WorkerFunc(func(ctx context.Context) { runSocialDeliveryProcessing(ctx, server) }),
		WorkerFunc(func(ctx context.Context) { server.Spaces.RunDiscordSocialGateway(ctx) }),
		WorkerFunc(func(ctx context.Context) { runAIEmbeddingProcessing(ctx, server) }),
	)
	// Domain gauges refresh on their own schedule so a scrape never holds a
	// database connection.
	if server.Metrics != nil {
		server.Metrics.StartSampling(workerContext, 15*time.Second)
	}

	log.Printf("Misty server running on :%s", runtimeConfig.Port)
	if err := runHTTPServer(TestingNewHTTPServer(":"+runtimeConfig.Port, server.Router), stopWorkers); err != nil {
		panic(err)
	}
	log.Println("Misty server stopped")
}

func runSocialDeliveryProcessing(ctx context.Context, server *Server) {
	if server.Spaces == nil || strings.EqualFold(strings.TrimSpace(envconfig.Getenv("MISTY_SOCIAL_SEND_DISABLED")), "true") {
		return
	}
	runDatabaseQueue(ctx, server, "social", func(ctx context.Context) (int, error) { return server.Spaces.ProcessSocialDelivery(ctx, 20) })
}

func runAIEmbeddingProcessing(ctx context.Context, server *Server) {
	if server.AIAnalyzer == nil || strings.TrimSpace(server.AIAnalyzer.APIKey) == "" {
		return
	}
	runDatabaseQueue(ctx, server, "embedding", func(ctx context.Context) (int, error) {
		processed := 0
		// Claim immediately before each provider call; queued chunks cannot outlive
		// their leases while an earlier chunk is processed.
		for processed < 32 && ctx.Err() == nil {
			chunks, err := server.Database.PendingAIEmbeddingChunks(ctx, 1)
			if err != nil {
				return processed, err
			}
			if len(chunks) == 0 {
				return processed, nil
			}
			chunk := chunks[0]
			processed++
			if err := embedRetrievalChunk(ctx, server, chunk); err != nil {
				cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				retryErr := server.Database.RetryAIEmbeddingChunk(cleanup, chunk)
				cancel()
				return processed, errors.Join(err, retryErr)
			}
		}
		return processed, ctx.Err()
	})
}

func runPersonalAgentTaskProcessing(ctx context.Context, server *Server) {
	if server.Spaces == nil {
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	workerID := "personal-agent-task-worker-" + uuid.NewString()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := server.Spaces.ProcessAssignedPersonalAgentRuns(ctx, workerID, 2); err != nil {
				log.Printf("Personal Agent Task processing failed: %v", err)
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
			if _, err := server.Database.ProcessAICleanupJobs(ctx, 25); err != nil {
				log.Printf("AI privacy cleanup failed: %v", err)
			}
			if _, err := server.Database.PurgeExpiredAITransients(ctx, 250); err != nil {
				log.Printf("AI transient retention cleanup failed: %v", err)
			}
			if server.Spaces != nil {
				if _, err := server.Spaces.ProcessAccountDeletions(ctx, 10); err != nil {
					log.Printf("Account deletion cleanup failed: %v", err)
				}
			}
			if server.AI != nil {
				if _, err := server.AI.ProcessDueAIRecaps(ctx, time.Now().UTC(), 25); err != nil {
					log.Printf("AI recurring briefing processing failed: %v", err)
				}
				if _, err := server.AI.ProcessDueScheduledTasks(ctx, time.Now().UTC(), 25); err != nil {
					log.Printf("Scheduled task processing failed: %v", err)
				}
			}
			if _, err := server.CleanupExpiredLibraryData(ctx, 100); err != nil {
				log.Printf("Library reservation cleanup failed: %v", err)
			}
			if _, err := server.CleanupExpiredJournalAssets(
				ctx, 24*time.Hour, 100,
			); err != nil {
				log.Printf("Journal asset cleanup failed: %v", err)
			}
			if server.Library != nil {
				if _, err := server.Database.ReleaseExpiredLibraryRenditionReservations(ctx, 100); err != nil {
					log.Printf("Library rendition reservation cleanup failed: %v", err)
				}
				if _, err := server.Library.PurgeExpiredRenditions(ctx, 20); err != nil {
					log.Printf("Library rendition purge failed: %v", err)
				}
			}
			if _, err := server.Database.PurgeExpiredNotes(ctx, 100); err != nil {
				log.Printf("Note retention purge failed: %v", err)
			}
			retentionCounter++
			if retentionCounter%10 == 0 {
				if server.Spaces != nil {
					if _, err := server.Spaces.PurgeDueAccountDeletions(ctx, 25); err != nil {
						log.Printf("Account deletion retention purge failed: %v", err)
					}
				}
				if server.Library != nil {
					report, reconcileErr := server.Library.ReconcileLibraryObjects(
						ctx, 24*time.Hour, 250,
					)
					if reconcileErr != nil {
						log.Printf("Library R2 reconciliation failed: %v", reconcileErr)
					} else if report.OrphanObjectsDeleted > 0 ||
						report.MissingPermanentObjects > 0 ||
						report.MismatchedObjects > 0 ||
						report.InterruptedFinalizations > 0 {
						log.Printf(
							"Library R2 reconciliation: checked=%d expired=%d orphan_deleted=%d missing=%d mismatched=%d retryable_finalizations=%d",
							report.InventoryObjectsChecked,
							report.ExpiredUploads,
							report.OrphanObjectsDeleted,
							report.MissingPermanentObjects,
							report.MismatchedObjects,
							report.InterruptedFinalizations,
						)
					}
				}
				if _, err := server.Database.PurgeExpiredSpaceData(ctx); err != nil {
					log.Printf("Space retention purge failed: %v", err)
				}
			}
		}
	}
}
