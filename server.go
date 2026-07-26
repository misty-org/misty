package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/api"
	appbilling "github.com/kannachi323/misty/server/billing"
	"github.com/kannachi323/misty/server/db"
	"github.com/kannachi323/misty/server/email"
	"github.com/kannachi323/misty/server/telemetry"
)

type Server struct {
	Router                    *chi.Mux
	Database                  *db.Database
	EmailSender               email.Sender
	AIAgent                   *serveragent.Service
	LibraryStore              api.LibraryObjectStore
	Library                   *api.SpaceLibraryService
	Demo                      *api.DemoService
	Spaces                    *api.SpacesService
	Realtime                  *api.RealtimeService
	PasswordResetStartURL     string
	PasswordResetRedirectURL  string
	WaitlistNotificationEmail string
	Telemetry                 telemetry.Client
	HealthMonitor             *healthMonitor
}

func CreateServer() (*Server, error) {
	warnOnInsecureBillingConfiguration()
	passwordResetRedirectURL, err := passwordResetRedirectURLFromEnv()
	if err != nil {
		return nil, err
	}
	passwordResetStartURL, err := passwordResetStartURLFromEnv()
	if err != nil {
		return nil, err
	}

	s := &Server{
		Router:                    chi.NewRouter(),
		Database:                  &db.Database{},
		PasswordResetStartURL:     passwordResetStartURL,
		PasswordResetRedirectURL:  passwordResetRedirectURL,
		WaitlistNotificationEmail: strings.TrimSpace(os.Getenv("WAITLIST_NOTIFY_EMAIL")),
		Telemetry:                 telemetry.NewFromEnv(),
	}
	s.AIAgent = serveragent.NewService(
		serveragent.NewSessionStoreWithPersistence(0, s.Database),
		// Every paid model call in the process passes through this ceiling, so
		// no path can run up an unbounded provider bill.
		serveragent.NewBudgetedProvider(
			serveragent.NewAgentProviderFromEnv(),
			serveragent.ProviderBudgetFromEnv(),
		),
		serveragent.WithUsageMeter(appbilling.NewCreditMeter(s.Database)),
	)
	s.LibraryStore, err = libraryStoreFromEnv()
	if err != nil {
		return nil, err
	}
	s.Library, err = api.NewSpaceLibraryService(s.Database, s.LibraryStore, true, 250<<20)
	if err != nil {
		return nil, fmt.Errorf("configure Space Library: %w", err)
	}
	s.Demo, err = api.NewDemoService(s.Database, s.LibraryStore, api.DemoConfigFromEnv())
	if err != nil {
		return nil, fmt.Errorf("configure demo management: %w", err)
	}
	mediaProcessingEnabled := false
	if mediaProcessorBin, lookupErr := exec.LookPath("ffmpeg"); lookupErr == nil {
		processor, processorErr := api.NewFFmpegLibraryMediaProcessor(mediaProcessorBin)
		if processorErr != nil {
			return nil, fmt.Errorf("configure Library media processor: %w", processorErr)
		}
		s.Library.SetMediaProcessor(processor)
		extractor, extractorErr := api.NewFFprobeLibraryMetadataExtractor(mediaProcessorBin)
		if extractorErr != nil {
			return nil, fmt.Errorf("configure Library metadata extractor: %w", extractorErr)
		}
		s.Library.SetMetadataExtractor(extractor)
		mediaProcessingEnabled = true
	}
	peopleProcessingEnabled := false
	if endpoint := strings.TrimSpace(os.Getenv("VISION_PROCESSOR_URL")); endpoint != "" {
		processor, processorErr := api.NewHTTPLibraryPeopleProcessor(endpoint, os.Getenv("VISION_PROCESSOR_TOKEN"))
		if processorErr != nil {
			return nil, fmt.Errorf("configure Library People processor: %w", processorErr)
		}
		s.Library.SetPeopleProcessor(processor)
		peopleProcessingEnabled = true
	}
	s.Library.SetSubsystems(true, true, mediaProcessingEnabled, peopleProcessingEnabled, mediaProcessingEnabled, true, true, true, true)
	spaceKey, err := spaceLinkEncryptionKeyFromEnv()
	if err != nil {
		return nil, err
	}
	s.Spaces, err = api.NewSpacesService(s.Database, s.AIAgent, spaceKey)
	if err != nil {
		return nil, fmt.Errorf("configure Space link encryption: %w", err)
	}
	s.Spaces.SetLibraryProvider(s.Library)
	s.Spaces.SetAvatarStore(s.LibraryStore)
	s.Realtime = api.NewRealtimeService(s.Database, s.Database.GetDSN())

	emailSender, err := email.NewSenderFromEnv()
	if err != nil {
		return nil, err
	}
	s.EmailSender = emailSender
	s.HealthMonitor = newHealthMonitor(s)

	return s, nil
}

func (s *Server) MountHandlers() error {
	s.Router.Use(cors.Handler(cors.Options{
		AllowOriginFunc:  func(_ *http.Request, origin string) bool { return isAllowedCORSOrigin(origin) },
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Misty-Platform", "X-Misty-Release-Channel", "X-Misty-Session-Id", "X-Misty-Analytics-Enabled", "X-Misty-Device-Timestamp", "X-Misty-Device-Nonce", "X-Misty-Device-Signature", "X-Misty-Attachment-Upload-Token", "X-Misty-Library-Upload-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	// The abuse guard runs first: a blocked caller is rejected before any
	// routing or handler work, and repeated per-route rejections escalate
	// into a block through the shared guard.
	// Blocks are persisted so a restart or a second instance still honours
	// them; the per-request counters stay in memory for speed.
	abuseGuard := api.NewAbuseGuard(api.DefaultAbusePolicy()).
		WithStore(context.Background(), s.Database)
	abuseGuard.StartRefreshLoop(context.Background(), 30*time.Second)
	s.Router.Use(abuseGuard.Middleware)
	s.Router.Use(api.NewAPIRateLimiter().WithAbuseGuard(abuseGuard).Middleware)

	passwordResetService, err := api.NewPasswordResetService(s.Database, s.EmailSender, s.PasswordResetStartURL, s.PasswordResetRedirectURL)
	if err != nil {
		return err
	}
	waitlistService, err := api.NewWaitlistService(s.Database, s.EmailSender, s.WaitlistNotificationEmail)
	if err != nil {
		return err
	}
	aiService := api.NewAIService(s.Database, s.AIAgent)
	libraryAnalyzer := &serveragent.SmartLibraryAnalyzer{
		APIKey:  strings.TrimSpace(os.Getenv("AI_GATEWAY_API_KEY")),
		BaseURL: strings.TrimSpace(os.Getenv("AI_GATEWAY_BASE_URL")),
	}
	intelligenceEnabled := libraryAnalyzer.APIKey != ""
	s.Library.SetIntelligence(libraryAnalyzer, intelligenceEnabled)
	smartLibraryService := api.NewSmartLibraryService(s.Database, libraryAnalyzer)
	mediaSearchService := api.NewMediaSearchService(s.Database, libraryAnalyzer)
	agentsService := api.NewAgentsService(s.Database)
	registerHandler := api.RegisterWithTelemetry(s.Database, s.Telemetry)
	loginHandler := api.Login(s.Database)
	logoutHandler := api.Logout(s.Database)
	forgotPasswordHandler := passwordResetService.Forgot()
	startResetHandler := passwordResetService.Start()
	validateResetTokenHandler := passwordResetService.Validate()
	resetPasswordHandler := passwordResetService.Reset()
	waitlistJoinHandler := waitlistService.Join()
	healthHandler := s.HealthMonitor.Handler()
	s.Router.Get("/health", healthHandler)
	s.Router.Get("/api/health", healthHandler)

	// Account management
	s.Router.Post("/register", registerHandler)
	s.Router.Post("/login", loginHandler)
	s.Router.Post("/logout", logoutHandler)
	s.Router.Post("/auth/forgot", forgotPasswordHandler)
	s.Router.Get("/auth/reset/start", startResetHandler)
	s.Router.Get("/auth/reset/validate", validateResetTokenHandler)
	s.Router.Post("/auth/reset", resetPasswordHandler)
	s.Router.Post("/waitlist", waitlistJoinHandler)

	// Dashboard — authenticated endpoints
	s.Router.Get("/me", api.GetMe(s.Database))
	s.Router.Put("/me/profile", api.UpdateProfile(s.Database))
	s.Router.MethodFunc(http.MethodGet, "/me/avatar", api.UserAvatar(s.Database, s.LibraryStore))
	s.Router.MethodFunc(http.MethodPut, "/me/avatar", api.UserAvatar(s.Database, s.LibraryStore))
	s.Router.Put("/me/device", api.UpdateDevice(s.Database))
	s.Router.Get("/me/settings", api.GetSettings(s.Database))
	s.Router.Put("/me/settings", api.UpdateSettings(s.Database))
	s.Router.Put("/me/telemetry", api.UpdateTelemetryPreferences(s.Database))
	s.Router.Post("/billing/trial/start", api.StartPersonalTrial(s.Database))
	s.Router.Post("/billing/checkout-session", api.CreateCheckoutSession(s.Database))
	s.Router.Post("/billing/credit-checkout-session", api.CreateCreditCheckoutSession(s.Database))
	s.Router.Post("/billing/portal-session", api.CreatePortalSession(s.Database))
	s.Router.Get("/billing/usage", api.GetBillingUsage(s.Database))
	s.mountAIRoutes("/ai", aiService)
	s.mountSmartLibraryRoutes("/ai/smart-library", smartLibraryService)
	s.mountMediaSearchRoutes("/ai/media-search", mediaSearchService)
	s.mountAgentsRoutes("", agentsService)
	s.mountSpacesRoutes("", s.Spaces, s.Realtime)
	if s.Library != nil {
		s.mountLibraryRoutes("", s.Library)
	}

	// Compatibility routes for clients configured with the /api prefix.
	s.Router.Post("/api/register", registerHandler)
	s.Router.Post("/api/login", loginHandler)
	s.Router.Post("/api/logout", logoutHandler)
	s.Router.Post("/api/auth/forgot", forgotPasswordHandler)
	s.Router.Get("/api/auth/reset/start", startResetHandler)
	s.Router.Get("/api/auth/reset/validate", validateResetTokenHandler)
	s.Router.Post("/api/auth/reset", resetPasswordHandler)
	s.Router.Post("/api/waitlist", waitlistJoinHandler)
	s.Router.Get("/api/me", api.GetMe(s.Database))
	s.Router.Put("/api/me/profile", api.UpdateProfile(s.Database))
	s.Router.MethodFunc(http.MethodGet, "/api/me/avatar", api.UserAvatar(s.Database, s.LibraryStore))
	s.Router.MethodFunc(http.MethodPut, "/api/me/avatar", api.UserAvatar(s.Database, s.LibraryStore))
	s.Router.Put("/api/me/device", api.UpdateDevice(s.Database))
	s.Router.Get("/api/me/settings", api.GetSettings(s.Database))
	s.Router.Put("/api/me/settings", api.UpdateSettings(s.Database))
	s.Router.Put("/api/me/telemetry", api.UpdateTelemetryPreferences(s.Database))
	s.Router.Post("/api/billing/trial/start", api.StartPersonalTrial(s.Database))
	s.Router.Post("/api/billing/checkout-session", api.CreateCheckoutSession(s.Database))
	s.Router.Post("/api/billing/credit-checkout-session", api.CreateCreditCheckoutSession(s.Database))
	s.Router.Post("/api/billing/portal-session", api.CreatePortalSession(s.Database))
	s.Router.Get("/api/billing/usage", api.GetBillingUsage(s.Database))
	s.mountAIRoutes("/api/ai", aiService)
	s.mountSmartLibraryRoutes("/api/ai/smart-library", smartLibraryService)
	s.mountMediaSearchRoutes("/api/ai/media-search", mediaSearchService)
	s.mountAgentsRoutes("/api", agentsService)
	s.mountSpacesRoutes("/api", s.Spaces, s.Realtime)
	if s.Library != nil {
		s.mountLibraryRoutes("/api", s.Library)
	}
	if s.Demo != nil {
		s.Router.Get("/api/internal/demo/status", s.Demo.Status())
		s.Router.Post("/api/internal/demo/reset", s.Demo.Reset())
		s.Router.Post("/api/internal/demo/agent-messages", s.Demo.AgentMessages())
	}

	// Stripe webhook — called by Stripe on payment events
	s.Router.Post("/stripe/webhook", api.StripeWebhookWithService(os.Getenv("STRIPE_WEBHOOK_SECRET"), appbilling.NewStripeService(s.Database, appbilling.WithTelemetry(s.Telemetry))))
	s.Spaces.StartProviderWorkers(context.Background())

	return nil
}

func (s *Server) mountLibraryRoutes(prefix string, library *api.SpaceLibraryService) {
	s.Router.MethodFunc(http.MethodGet, prefix+"/search/spaces", library.GlobalSemanticSearch())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library", library.Items())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/facets", library.Facets())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/search/semantic", library.SemanticSearch())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/discovery", library.Discovery())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/discovery/{kind}/{groupID}/items", library.DiscoveryItems())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/library/discovery/memory/{memoryID}", library.MemoryPreference())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/pins", library.PinnedCollections())
	s.Router.MethodFunc(http.MethodPut, prefix+"/spaces/{spaceID}/library/pins", library.PinnedCollections())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/duplicates/merge", library.MergeDuplicates())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/exports/download", library.ExportItems())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/imports", library.ImportItems())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/imports/history", library.ImportHistory())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/shared", library.SharedReferences())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/shared", library.SharedReferences())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/shared/{referenceID}/download", library.SharedReferenceDownload())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/library/grants/{grantID}", library.RevokeGrant())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/usage", library.Usage())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/reauthenticate", library.Reauthenticate())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/asset-stacks", library.AssetStacks())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/asset-stacks", library.AssetStacks())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/library/asset-stacks/{stackID}", library.AssetStack())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/library/asset-stacks/{stackID}", library.AssetStack())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/uploads", library.InitiateUpload())
	s.Router.MethodFunc(http.MethodPut, prefix+"/spaces/{spaceID}/library/uploads/{uploadID}/content", library.UploadContent())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/uploads/{uploadID}/finalize", library.FinalizeUpload())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/items/bulk", library.BulkItems())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/items/duplicate", library.DuplicateItems())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/items/{itemID}", library.Item())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/library/items/{itemID}", library.Item())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/items/{itemID}/download", library.DownloadItem())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/items/{itemID}/preview", library.PreviewItem())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/items/{itemID}/trash", library.TrashItem())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/items/{itemID}/restore", library.RestoreItem())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/attachments/{attachmentID}/download", library.DownloadAttachment())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/attachments/{attachmentID}/promote", library.PromoteAttachment())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/albums", library.Albums())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/albums", library.Albums())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/albums/{albumID}", library.Album())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/library/albums/{albumID}", library.Album())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/library/albums/{albumID}", library.Album())
	s.Router.MethodFunc(http.MethodPut, prefix+"/spaces/{spaceID}/library/albums/{albumID}/organization", library.OrganizeAlbum())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/albums/{albumID}/order", library.ReorderAlbumItems())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/albums/{albumID}/items", library.AlbumItems())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/albums/{albumID}/items", library.AlbumItems())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/library/albums/{albumID}/items/{itemID}", library.AlbumItems())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/album-folders", library.AlbumFolders())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/album-folders", library.AlbumFolders())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/library/album-folders/{folderID}", library.AlbumFolder())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/library/album-folders/{folderID}", library.AlbumFolder())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/groups", library.Groups())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/groups", library.Groups())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/groups/{groupID}/items", library.GroupItems())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/people/policy", library.PeoplePolicy())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/library/people/policy", library.PeoplePolicy())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/people", library.People())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/people", library.People())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/people/merge", library.MergePeople())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/people/{personID}", library.Person())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/library/people/{personID}", library.Person())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/library/people/{personID}", library.Person())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/people/{personID}/items", library.PersonItems())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/people/{personID}/items", library.PersonItems())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/library/people/{personID}/items", library.PersonItems())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/library/items/{itemID}/versions", library.EditVersions())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/items/{itemID}/versions", library.EditVersions())
	s.Router.MethodFunc(http.MethodPut, prefix+"/spaces/{spaceID}/library/items/{itemID}/versions/current", library.SelectEditVersion())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/library/items/{itemID}/versions/{editID}/render", library.RenderEditVersion())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/library/items/{itemID}/versions/{editID}", library.DeleteEditVersion())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/members/{userID}/permissions", library.MemberPermissions())
	s.Router.MethodFunc(http.MethodPut, prefix+"/spaces/{spaceID}/members/{userID}/permissions", library.MemberPermissions())
}

func (s *Server) mountSpacesRoutes(prefix string, spaces *api.SpacesService, realtime *api.RealtimeService) {
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces", spaces.Spaces())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces", spaces.Spaces())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}", spaces.Space())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}", spaces.Space())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}", spaces.Space())
	s.Router.Get(prefix+"/spaces/{spaceID}/members", spaces.Members())
	s.Router.Get(prefix+"/spaces/{spaceID}/members/{userID}/avatar", spaces.MemberAvatar())
	s.Router.Post(prefix+"/spaces/{spaceID}/invitations", spaces.Invite())
	s.Router.Post(prefix+"/spaces/invitations/{inviteID}/accept", spaces.RespondInvite(true))
	s.Router.Post(prefix+"/spaces/invitations/{inviteID}/decline", spaces.RespondInvite(false))
	s.Router.Delete(prefix+"/spaces/{spaceID}/members/{userID}", spaces.RemoveMember())
	s.Router.Post(prefix+"/spaces/{spaceID}/leave", spaces.LeaveSpace())
	s.Router.Post(prefix+"/spaces/{spaceID}/transfer", spaces.TransferOwner())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/messages", spaces.Messages())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/messages", spaces.Messages())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/conversations", spaces.Conversations())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/conversations", spaces.Conversations())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/conversations/{conversationID}", spaces.Conversation())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/conversations/{conversationID}/messages", spaces.ConversationMessages())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/conversations/{conversationID}/messages", spaces.ConversationMessages())
	s.Router.MethodFunc(http.MethodPut, prefix+"/spaces/{spaceID}/conversations/{conversationID}/messages/{messageID}", spaces.ConversationMessage())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/conversations/{conversationID}/messages/{messageID}", spaces.ConversationMessage())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/chat/agents", spaces.ChatAgents())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/tasks", spaces.SpaceTasks())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/tasks", spaces.SpaceTasks())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/tasks/{taskID}", spaces.SpaceTask())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/tasks/{taskID}", spaces.SpaceTask())
	s.Router.Post(prefix+"/spaces/{spaceID}/tasks/{taskID}/move", spaces.MoveSpaceTask())
	s.Router.Get(prefix+"/spaces/{spaceID}/calendar/events", spaces.SpaceCalendar())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/calendar/sources", spaces.SpaceCalendarSources())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/calendar/sources", spaces.SpaceCalendarSources())
	s.Router.Delete(prefix+"/spaces/{spaceID}/calendar/sources/{sourceID}", spaces.SpaceCalendarSource())
	s.Router.Get(prefix+"/spaces/{spaceID}/calendar/google/calendars", spaces.AvailableGoogleCalendars())
	s.Router.Post(prefix+"/spaces/{spaceID}/calendar/sync", spaces.SyncCalendarTasks())
	s.Router.Post(prefix+"/spaces/{spaceID}/tasks/calendar", spaces.CreateCalendarTask())
	s.Router.Post(prefix+"/spaces/{spaceID}/tasks/{taskID}/calendar/publish", spaces.PublishTaskToCalendar())
	s.Router.Post(prefix+"/spaces/{spaceID}/tasks/{taskID}/calendar/resolve", spaces.ResolveTaskCalendarConflict())
	s.Router.MethodFunc(http.MethodPut, prefix+"/spaces/{spaceID}/messages/{messageID}", spaces.Message())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/messages/{messageID}", spaces.Message())
	s.Router.Post(prefix+"/spaces/{spaceID}/read", spaces.MarkRead())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/nodes", spaces.Nodes())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/nodes", spaces.Nodes())
	s.Router.MethodFunc(http.MethodPut, prefix+"/spaces/{spaceID}/nodes/{nodeID}", spaces.Node())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/nodes/{nodeID}", spaces.Node())
	s.Router.Post(prefix+"/spaces/{spaceID}/nodes/{nodeID}/resolve", spaces.ResolveTicket())
	s.Router.Get(prefix+"/spaces/resolve/{ticket}", spaces.Resolve())
	s.Router.Get(prefix+"/activity/inbox", spaces.Inbox())
	s.Router.Post(prefix+"/activity/inbox/seen", spaces.InboxSeen())
	s.Router.Post(prefix+"/activity/inbox/clear", spaces.InboxClear())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/studio/agents", spaces.StudioResources("agent"))
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/studio/agents", spaces.StudioResources("agent"))
	s.Router.Delete(prefix+"/spaces/{spaceID}/studio/agents/{resourceID}", spaces.DeleteStudioResource("agent"))
	s.Router.Post(prefix+"/spaces/{spaceID}/studio/agents/{resourceID}/runs", spaces.RunStudioResource("agent"))
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/agents/{agentID}/runs", spaces.DirectAgentRun())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/agents/{agentID}/runs", spaces.DirectAgentRun())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/studio/agents/{agentID}/versions", spaces.AgentVersions())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/studio/agents/{agentID}/versions", spaces.AgentVersions())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/agents/{agentID}/instance", spaces.AgentInstance())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/agents/{agentID}/instance", spaces.AgentInstance())
	s.Router.Put(prefix+"/agent-instances/{instanceID}/workflows/{workflowVersionID}", spaces.AgentInstanceWorkflow())
	s.Router.Put(prefix+"/agent-instances/{instanceID}/connections", spaces.AgentInstanceConnections())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/studio/workflows", spaces.StudioResources("workflow"))
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/studio/workflows", spaces.StudioResources("workflow"))
	s.Router.Delete(prefix+"/spaces/{spaceID}/studio/workflows/{resourceID}", spaces.DeleteStudioResource("workflow"))
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/studio/workflows/{workflowID}/versions", spaces.WorkflowVersions())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/studio/workflows/{workflowID}/versions", spaces.WorkflowVersions())
	s.Router.Get(prefix+"/agents/catalog", spaces.AgentCatalog())
	s.Router.Get(prefix+"/mika/discovery", spaces.AgentDiscovery())
	s.Router.Post(prefix+"/mika/delegations", spaces.AgentDelegation())
	s.Router.MethodFunc(http.MethodGet, prefix+"/agent-conversations", spaces.AgentConversations())
	s.Router.MethodFunc(http.MethodPost, prefix+"/agent-conversations", spaces.AgentConversations())
	s.Router.MethodFunc(http.MethodGet, prefix+"/agent-conversations/{conversationID}/events", spaces.AgentConversationEvents())
	s.Router.MethodFunc(http.MethodPost, prefix+"/agent-conversations/{conversationID}/events", spaces.AgentConversationEvents())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/integrations", spaces.SpaceIntegrations())
	s.Router.Get(prefix+"/spaces/{spaceID}/integrations/{integrationID}/resources", spaces.AvailableProviderResources())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/provider-resources", spaces.ProviderSharedResources())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/provider-resources", spaces.ProviderSharedResources())
	s.Router.Delete(prefix+"/spaces/{spaceID}/provider-resources/{resourceID}", spaces.ProviderSharedResource())
	// Connections are created only through branded OAuth/install flows. The
	// legacy PUT route is intentionally not mounted because callers must never
	// supply their own credential/vault reference.
	s.Router.Post(prefix+"/spaces/{spaceID}/integrations/{provider}/authorize", spaces.BeginProviderAuthorization())
	s.Router.Get(prefix+"/oauth/providers/{provider}/callback", spaces.ProviderAuthorizationCallback())
	s.Router.Post(prefix+"/provider-callbacks/google/calendar", spaces.GoogleCalendarCallback())
	s.Router.Post(prefix+"/provider-callbacks/slack-events", spaces.SlackEventsCallback())
	s.Router.Post(prefix+"/provider-callbacks/notion-events", spaces.NotionEventsCallback())
	s.Router.Delete(prefix+"/integrations/{integrationID}", spaces.DeleteProviderIntegration())

	// Space ↔ Discord conversation mirroring.
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/integrations/discord/link", spaces.SpaceDiscordLink())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/integrations/discord/link", spaces.SpaceDiscordLink())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/integrations/discord/link/{linkID}", spaces.SpaceDiscordLinkItem())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}/integrations/discord/link/{linkID}", spaces.SpaceDiscordLinkItem())
	s.Router.Post(prefix+"/spaces/{spaceID}/integrations/discord/link/{linkID}/sync", spaces.SyncSpaceDiscordLink())
	s.Router.Post(prefix+"/spaces/{spaceID}/integrations/discord/link/{linkID}/publish", spaces.PublishSpaceDiscordMessage())

	// Notion read/write proxy. The Notion token stays server-side.
	s.Router.Get(prefix+"/spaces/{spaceID}/integrations/notion/status", spaces.NotionStatus())
	s.Router.Delete(prefix+"/spaces/{spaceID}/integrations/notion/connection", spaces.NotionConnection())
	s.Router.Get(prefix+"/spaces/{spaceID}/integrations/notion/sources", spaces.NotionSources())
	s.Router.Get(prefix+"/spaces/{spaceID}/integrations/notion/search", spaces.NotionSearch())
	s.Router.Post(prefix+"/spaces/{spaceID}/integrations/notion/pages", spaces.NotionPages())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/integrations/notion/pages/{pageID}", spaces.NotionPage())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}/integrations/notion/pages/{pageID}", spaces.NotionPage())
	s.Router.Get(prefix+"/spaces/{spaceID}/integrations/notion/pages/{pageID}/blocks", spaces.NotionPageBlocks())
	s.Router.Patch(prefix+"/spaces/{spaceID}/integrations/notion/blocks/{blockID}/children", spaces.NotionBlockChildren())
	s.Router.Get(prefix+"/spaces/{spaceID}/integrations/notion/databases/{databaseID}", spaces.NotionDatabase())
	s.Router.Post(prefix+"/spaces/{spaceID}/integrations/notion/databases/{databaseID}/query", spaces.NotionDatabaseQuery())
	s.Router.Get(prefix+"/runs/{runID}", spaces.RunDetail())
	s.Router.Post(prefix+"/runs/{runID}/approval", spaces.RunDecision())
	s.Router.Post(prefix+"/runs/{runID}/cancel", spaces.RunCancel())
	s.Router.Post(prefix+"/runs/{runID}/retry", spaces.RunRetry())
	s.Router.Post(prefix+"/realtime/tickets", realtime.Ticket())
	s.Router.Get(prefix+"/realtime", realtime.Connect())
}

func (s *Server) StartRealtime() error {
	if s.Realtime == nil {
		return nil
	}
	return s.Realtime.Start()
}

func spaceLinkEncryptionKeyFromEnv() (string, error) {
	if key := strings.TrimSpace(os.Getenv("SPACE_LINK_ENCRYPTION_KEY")); key != "" {
		return key, nil
	}
	seed := strings.TrimSpace(os.Getenv("DOCUMENT_SIGNING_KEY"))
	if seed == "" {
		if strings.EqualFold(strings.TrimSpace(os.Getenv("MISTY_ENVIRONMENT")), "production") {
			return "", fmt.Errorf("SPACE_LINK_ENCRYPTION_KEY is required in production")
		}
		seed = "misty-development-space-link-key"
	}
	sum := sha256.Sum256([]byte("misty-space-links:" + seed))
	return base64.StdEncoding.EncodeToString(sum[:]), nil
}

func (s *Server) CleanupExpiredLibraryData(ctx context.Context, limit int) (int, error) {
	if s.Library == nil {
		return 0, nil
	}
	return s.Library.CleanupExpired(ctx, limit)
}

func (s *Server) mountAgentsRoutes(prefix string, service *api.AgentsService) {
	s.Router.MethodFunc(http.MethodGet, prefix+"/agents", service.PersonalAgents())
	s.Router.MethodFunc(http.MethodPost, prefix+"/agents", service.PersonalAgents())
	s.Router.MethodFunc(http.MethodGet, prefix+"/agents/{agentID}", service.PersonalAgent())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/agents/{agentID}", service.PersonalAgent())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/agents/{agentID}", service.PersonalAgent())
	s.Router.MethodFunc(http.MethodGet, prefix+"/agents/{agentID}/space-grants", service.PersonalAgentGrants())
	s.Router.MethodFunc(http.MethodPut, prefix+"/agents/{agentID}/space-grants", service.PersonalAgentGrants())
	s.Router.MethodFunc(http.MethodGet, prefix+"/ai/models", service.Models())
	if !serverFeatureEnabled("MISTY_DEVICE_JOBS_ENABLED") {
		return
	}
	s.Router.Post(prefix+"/devices", service.RegisterDevice())
	s.Router.Get(prefix+"/devices", service.ListDevices())
	s.Router.Post(prefix+"/devices/{deviceID}/heartbeat", service.DeviceAuthenticated(service.HeartbeatDevice()))
	s.Router.Post(prefix+"/devices/{deviceID}/revoke", service.RevokeDevice())
	s.Router.Post(prefix+"/devices/{deviceID}/workflow-node-jobs/claim", service.DeviceAuthenticated(service.ClaimWorkflowNodeJob()))
	s.Router.Post(prefix+"/devices/{deviceID}/workflow-node-jobs/{jobID}/lease", service.DeviceAuthenticated(service.WorkflowNodeLeaseAction("renew")))
	s.Router.Post(prefix+"/devices/{deviceID}/workflow-node-jobs/{jobID}/complete", service.DeviceAuthenticated(service.WorkflowNodeLeaseAction("complete")))
	s.Router.Post(prefix+"/devices/{deviceID}/workflow-node-jobs/{jobID}/fail", service.DeviceAuthenticated(service.WorkflowNodeLeaseAction("fail")))
}

func serverFeatureEnabled(name string) bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(name)), "true")
}

type r2Config struct {
	endpoint, bucket, accessKey, secretKey string
}

func r2ConfigFromEnv() r2Config {
	return r2Config{
		endpoint:  strings.TrimSpace(os.Getenv("R2_ENDPOINT")),
		bucket:    strings.TrimSpace(os.Getenv("R2_BUCKET")),
		accessKey: strings.TrimSpace(os.Getenv("R2_ACCESS_KEY")),
		secretKey: strings.TrimSpace(os.Getenv("R2_SECRET_KEY")),
	}
}

func (config r2Config) empty() bool {
	return config.endpoint == "" && config.bucket == "" && config.accessKey == "" && config.secretKey == ""
}

func libraryStoreFromEnv() (api.LibraryObjectStore, error) {
	config := r2ConfigFromEnv()
	environment := strings.TrimSpace(os.Getenv("MISTY_ENVIRONMENT"))
	demoMode := strings.TrimSpace(os.Getenv("MISTY_DEMO_MODE"))
	if localRoot := strings.TrimSpace(os.Getenv("MISTY_LIBRARY_LOCAL_DIR")); localRoot != "" {
		if strings.EqualFold(environment, "production") {
			return nil, fmt.Errorf("MISTY_LIBRARY_LOCAL_DIR cannot be used in production")
		}
		store, err := api.NewLocalLibraryObjectStore(localRoot)
		if err != nil {
			return nil, fmt.Errorf("configure local Library store: %w", err)
		}
		return store, nil
	}
	if demoMode == "local" {
		return nil, fmt.Errorf("MISTY_LIBRARY_LOCAL_DIR is required for local demo mode")
	}
	if demoMode == "staging" && config.empty() {
		return nil, fmt.Errorf("dedicated R2 storage is required for staging demo mode")
	}
	if config.empty() && !strings.EqualFold(environment, "production") {
		return api.NewMemoryLibraryObjectStore(), nil
	}
	if config.endpoint == "" {
		return nil, fmt.Errorf("R2_ENDPOINT is required for the Space Library")
	}
	store, err := api.NewS3LibraryObjectStore(api.S3LibraryObjectStoreConfig{
		Endpoint: config.endpoint, Region: "auto", Bucket: config.bucket,
		AccessKeyID: config.accessKey, SecretAccessKey: config.secretKey,
		ForcePathStyle: true, BucketPrivate: true, PermanentObjects: true,
	})
	if err != nil {
		return nil, fmt.Errorf("configure R2 Library store: %w", err)
	}
	return store, nil
}

func (s *Server) mountMediaSearchRoutes(prefix string, service *api.MediaSearchService) {
	s.Router.Post(prefix+"/chunks", service.IndexChunk())
	s.Router.Post(prefix+"/search", service.Search())
	s.Router.Get(prefix+"/status", service.Status())
	s.Router.Delete(prefix+"/assets/{assetID}", service.DeleteAsset())
	s.Router.Delete(prefix+"/devices/{deviceID}", service.DeleteDevice())
	s.Router.Post(prefix+"/devices/{deviceID}/adopt-legacy", service.AdoptLegacyDevice())
}

func (s *Server) mountSmartLibraryRoutes(prefix string, service *api.SmartLibraryService) {
	s.Router.Post(prefix+"/search", service.GlobalSearch())
	s.Router.Get(prefix+"/index-status", service.IndexStatus())
	s.Router.Post(prefix+"/reindex", service.PlanReindex())
	s.Router.Post(prefix+"/reindex/{jobID}/complete", service.CompleteReindex())
	s.Router.Post(prefix+"/folders", service.RegisterFolder())
	s.Router.Post(prefix+"/folders/{folderID}/preflight", service.Preflight())
	s.Router.Post(prefix+"/folders/{folderID}/sample", service.CreateSample())
	s.Router.Post(prefix+"/folders/{folderID}/sample/approve", service.Approve("sample"))
	s.Router.Post(prefix+"/folders/{folderID}/approve", service.Approve("full"))
	s.Router.Get(prefix+"/folders/{folderID}/progress", service.Progress())
	s.Router.Get(prefix+"/folders/{folderID}/results", service.Results())
	s.Router.Put(prefix+"/folders/{folderID}/assets/{assetID}/tags", service.SetAssetTags())
	s.Router.Post(prefix+"/folders/{folderID}/rescan", service.Rescan())
	s.Router.Post(prefix+"/folders/{folderID}/search", service.Search())
	s.Router.Delete(prefix+"/folders/{folderID}", service.Delete())
}

func allowedCORSOrigins() []string {
	origins := []string{
		"tauri://localhost",
		"http://tauri.localhost",
		"https://tauri.localhost",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
	}
	for _, origin := range strings.Split(os.Getenv("MISTY_ALLOWED_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" && !strings.Contains(origin, "*") {
			origins = append(origins, origin)
		}
	}
	return origins
}

func isAllowedCORSOrigin(origin string) bool {
	for _, allowed := range allowedCORSOrigins() {
		if strings.EqualFold(origin, allowed) {
			return true
		}
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "http" || !isLocalhostHostname(parsed.Hostname()) || parsed.Path != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	port, err := strconv.Atoi(parsed.Port())
	return err == nil && port >= 5173 && port <= 5199
}

func (s *Server) mountAIRoutes(prefix string, aiService *api.AIService) {
	s.Router.Get(prefix+"/status", aiService.Status())
	s.Router.Post(prefix+"/complete", aiService.Complete())
	s.Router.Get(prefix+"/sessions", aiService.Sessions())
	s.Router.Post(prefix+"/sessions", aiService.CreateSession())
	s.Router.Patch(prefix+"/sessions/{sessionID}", aiService.RenameSession())
	s.Router.Post(prefix+"/sessions/{sessionID}/messages", aiService.SendMessage())
	s.Router.Get(prefix+"/sessions/{sessionID}/events", aiService.Events())
	s.Router.Get(prefix+"/sessions/{sessionID}/transcript", aiService.Transcript())
	s.Router.Post(prefix+"/sessions/{sessionID}/tool-results", aiService.SubmitToolResults())
	s.Router.Post(prefix+"/sessions/{sessionID}/cancel", aiService.Cancel())
	s.Router.Delete(prefix+"/sessions/{sessionID}", aiService.DeleteConversation())
}

func passwordResetRedirectURLFromEnv() (string, error) {
	rawURL := os.Getenv("PASSWORD_RESET_URL")
	if rawURL == "" {
		rawURL = "http://localhost:5173/#/reset"
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("invalid PASSWORD_RESET_URL: %w", err)
	}
	if parsedURL.Host == "" {
		return "", fmt.Errorf("PASSWORD_RESET_URL must include a host")
	}
	if parsedURL.Scheme == "https" {
		return parsedURL.String(), nil
	}
	if parsedURL.Scheme == "http" && isLocalhostHostname(parsedURL.Hostname()) {
		return parsedURL.String(), nil
	}

	return "", fmt.Errorf("PASSWORD_RESET_URL must use https unless it targets localhost")
}

func passwordResetStartURLFromEnv() (string, error) {
	rawURL := os.Getenv("PASSWORD_RESET_START_URL")
	if rawURL == "" {
		rawURL = "http://localhost:8080/auth/reset/start"
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("invalid PASSWORD_RESET_START_URL: %w", err)
	}
	if parsedURL.Host == "" {
		return "", fmt.Errorf("PASSWORD_RESET_START_URL must include a host")
	}
	if parsedURL.Scheme == "https" {
		return parsedURL.String(), nil
	}
	if parsedURL.Scheme == "http" && isLocalhostHostname(parsedURL.Hostname()) {
		return parsedURL.String(), nil
	}

	return "", fmt.Errorf("PASSWORD_RESET_START_URL must use https unless it targets localhost")
}

func isLocalhostHostname(host string) bool {
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

// warnOnInsecureBillingConfiguration surfaces a missing webhook secret at boot
// rather than on the first forged event. The handler refuses those requests
// regardless; this exists so the operator learns before real Stripe events are
// silently rejected too.
func warnOnInsecureBillingConfiguration() {
	if len(strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET"))) < 16 {
		log.Println("SECURITY: STRIPE_WEBHOOK_SECRET is unset or too short; Stripe webhooks will be refused")
	}
	if trustProxyHeadersEnabled() && strings.TrimSpace(os.Getenv("TRUSTED_PROXY_CIDRS")) == "" {
		log.Println("NOTICE: TRUST_PROXY_HEADERS is on and TRUSTED_PROXY_CIDRS is unset; " +
			"forwarded headers are honoured only from loopback and private ranges")
	}
}

func trustProxyHeadersEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("TRUST_PROXY_HEADERS"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}
