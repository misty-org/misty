package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

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
	AgentAttachmentStore      api.AgentAttachmentStore
	AgentAttachments          *api.AgentAttachmentsService
	Spaces                    *api.SpacesService
	Realtime                  *api.RealtimeService
	PasswordResetStartURL     string
	PasswordResetRedirectURL  string
	WaitlistNotificationEmail string
	Telemetry                 telemetry.Client
}

func CreateServer() (*Server, error) {
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
		serveragent.NewMikaProviderFromEnv(),
		serveragent.WithUsageMeter(appbilling.NewCreditMeter(s.Database)),
	)
	if serverFeatureEnabled("MISTY_AGENT_DOCUMENTS_ENABLED") {
		s.AgentAttachmentStore, err = agentAttachmentStoreFromEnv()
		if err != nil {
			return nil, err
		}
		s.AgentAttachments, err = api.NewAgentAttachmentsService(s.Database, s.AgentAttachmentStore, []byte(os.Getenv("DOCUMENT_SIGNING_KEY")))
		if err != nil {
			return nil, fmt.Errorf("configure agent attachment encryption: %w", err)
		}
		envelopeKeys, err := agentAttachmentEnvelopeKeyringFromEnv()
		if err != nil {
			return nil, fmt.Errorf("configure agent attachment envelope keys: %w", err)
		}
		if err := s.AgentAttachments.SetEnvelopeKeyring(envelopeKeys); err != nil {
			return nil, fmt.Errorf("configure agent attachment envelope keys: %w", err)
		}
	}
	spaceKey, err := spaceLinkEncryptionKeyFromEnv()
	if err != nil {
		return nil, err
	}
	s.Spaces, err = api.NewSpacesService(s.Database, s.AIAgent, spaceKey)
	if err != nil {
		return nil, fmt.Errorf("configure Space link encryption: %w", err)
	}
	s.Realtime = api.NewRealtimeService(s.Database, s.Database.GetDSN())

	emailSender, err := email.NewSenderFromEnv()
	if err != nil {
		return nil, err
	}
	s.EmailSender = emailSender

	return s, nil
}

func (s *Server) MountHandlers() error {
	s.Router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedCORSOrigins(),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Misty-Platform", "X-Misty-Release-Channel", "X-Misty-Session-Id", "X-Misty-Analytics-Enabled", "X-Misty-Device-Timestamp", "X-Misty-Device-Nonce", "X-Misty-Device-Signature", "X-Misty-Attachment-Upload-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	s.Router.Use(api.NewAPIRateLimiter().Middleware)

	passwordResetService, err := api.NewPasswordResetService(s.Database, s.EmailSender, s.PasswordResetStartURL, s.PasswordResetRedirectURL)
	if err != nil {
		return err
	}
	waitlistService, err := api.NewWaitlistService(s.Database, s.EmailSender, s.WaitlistNotificationEmail)
	if err != nil {
		return err
	}
	aiService := api.NewAIService(s.Database, s.AIAgent)
	aiService.SetAgentAttachments(s.AgentAttachments)
	smartLibraryService := api.NewSmartLibraryService(s.Database, &serveragent.SmartLibraryAnalyzer{
		APIKey:  strings.TrimSpace(os.Getenv("AI_GATEWAY_API_KEY")),
		BaseURL: strings.TrimSpace(os.Getenv("AI_GATEWAY_BASE_URL")),
	})
	mediaSearchService := api.NewMediaSearchService(s.Database, &serveragent.SmartLibraryAnalyzer{APIKey: strings.TrimSpace(os.Getenv("AI_GATEWAY_API_KEY")), BaseURL: strings.TrimSpace(os.Getenv("AI_GATEWAY_BASE_URL"))})
	agentsService := api.NewAgentsService(s.Database)
	registerHandler := api.RegisterWithTelemetry(s.Database, s.Telemetry)
	loginHandler := api.Login(s.Database)
	logoutHandler := api.Logout(s.Database)
	forgotPasswordHandler := passwordResetService.Forgot()
	startResetHandler := passwordResetService.Start()
	validateResetTokenHandler := passwordResetService.Validate()
	resetPasswordHandler := passwordResetService.Reset()
	waitlistJoinHandler := waitlistService.Join()

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
	if s.AgentAttachments != nil {
		s.mountAgentAttachmentRoutes("", s.AgentAttachments)
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
	if s.AgentAttachments != nil {
		s.mountAgentAttachmentRoutes("/api", s.AgentAttachments)
	}

	// Stripe webhook — called by Stripe on payment events
	s.Router.Post("/stripe/webhook", api.StripeWebhookWithService(os.Getenv("STRIPE_WEBHOOK_SECRET"), appbilling.NewStripeService(s.Database, appbilling.WithTelemetry(s.Telemetry))))

	return nil
}

func (s *Server) mountSpacesRoutes(prefix string, spaces *api.SpacesService, realtime *api.RealtimeService) {
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces", spaces.Spaces())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces", spaces.Spaces())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}", spaces.Space())
	s.Router.MethodFunc(http.MethodPatch, prefix+"/spaces/{spaceID}", spaces.Space())
	s.Router.MethodFunc(http.MethodDelete, prefix+"/spaces/{spaceID}", spaces.Space())
	s.Router.Get(prefix+"/spaces/{spaceID}/members", spaces.Members())
	s.Router.Post(prefix+"/spaces/{spaceID}/invitations", spaces.Invite())
	s.Router.Post(prefix+"/spaces/invitations/{inviteID}/accept", spaces.RespondInvite(true))
	s.Router.Post(prefix+"/spaces/invitations/{inviteID}/decline", spaces.RespondInvite(false))
	s.Router.Delete(prefix+"/spaces/{spaceID}/members/{userID}", spaces.RemoveMember())
	s.Router.Post(prefix+"/spaces/{spaceID}/leave", spaces.LeaveSpace())
	s.Router.Post(prefix+"/spaces/{spaceID}/transfer", spaces.TransferOwner())
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/messages", spaces.Messages())
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/messages", spaces.Messages())
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
	s.Router.MethodFunc(http.MethodGet, prefix+"/spaces/{spaceID}/studio/workflows", spaces.StudioResources("workflow"))
	s.Router.MethodFunc(http.MethodPost, prefix+"/spaces/{spaceID}/studio/workflows", spaces.StudioResources("workflow"))
	s.Router.Delete(prefix+"/spaces/{spaceID}/studio/workflows/{resourceID}", spaces.DeleteStudioResource("workflow"))
	s.Router.Post(prefix+"/spaces/{spaceID}/studio/workflows/{resourceID}/runs", spaces.RunStudioResource("workflow"))
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

func (s *Server) mountAgentAttachmentRoutes(prefix string, service *api.AgentAttachmentsService) {
	s.Router.Get(prefix+"/agents/attachments/envelope", service.Envelope())
	s.Router.Post(prefix+"/agents/jobs/{jobID}/attachments/initiate", service.InitiateUpload())
	s.Router.Put(prefix+"/agents/jobs/{jobID}/attachments/{attachmentID}/content", service.UploadContent())
	s.Router.Post(prefix+"/agents/jobs/{jobID}/attachments/{attachmentID}/finalize", service.FinalizeUpload())
	s.Router.Delete(prefix+"/agents/jobs/{jobID}/attachments/{attachmentID}", service.DeleteAttachment())
}

// PurgeExpiredAgentData is intended for the deployment scheduler. Objects are
// deleted before their wrapped keys are erased from the database.
func (s *Server) PurgeExpiredAgentData(ctx context.Context, limit int) (int, error) {
	if s.AgentAttachments == nil {
		return 0, nil
	}
	return s.AgentAttachments.PurgeExpired(ctx, limit)
}

func (s *Server) mountAgentsRoutes(prefix string, service *api.AgentsService) {
	deviceJobsEnabled := serverFeatureEnabled("MISTY_DEVICE_JOBS_ENABLED")
	folderAgentsEnabled := serverFeatureEnabled("MISTY_FOLDER_AGENTS_ENABLED")
	if !deviceJobsEnabled && !folderAgentsEnabled {
		return
	}
	s.Router.Post(prefix+"/devices", service.RegisterDevice())
	s.Router.Get(prefix+"/devices", service.ListDevices())
	s.Router.Post(prefix+"/devices/{deviceID}/heartbeat", service.DeviceAuthenticated(service.HeartbeatDevice()))
	s.Router.Post(prefix+"/devices/{deviceID}/revoke", service.RevokeDevice())
	if deviceJobsEnabled {
		s.Router.Post(prefix+"/devices/{deviceID}/jobs/claim", service.DeviceAuthenticated(service.ClaimJob()))
		s.Router.Post(prefix+"/devices/{deviceID}/jobs/{jobID}/lease", service.DeviceAuthenticated(service.LeaseAction("renew")))
		s.Router.Post(prefix+"/devices/{deviceID}/jobs/{jobID}/start", service.DeviceAuthenticated(service.LeaseAction("start")))
		s.Router.Post(prefix+"/devices/{deviceID}/jobs/{jobID}/progress", service.DeviceAuthenticated(service.LeaseAction("progress")))
		s.Router.Post(prefix+"/devices/{deviceID}/jobs/{jobID}/complete", service.DeviceAuthenticated(service.LeaseAction("complete")))
		s.Router.Post(prefix+"/devices/{deviceID}/jobs/{jobID}/fail", service.DeviceAuthenticated(service.LeaseAction("fail")))
	}
	if !folderAgentsEnabled {
		return
	}
	s.Router.Post(prefix+"/agents", service.CreateAgent())
	s.Router.Get(prefix+"/agents", service.ListAgents())
	s.Router.Get(prefix+"/agents/snapshot", service.Snapshot())
	s.Router.Get(prefix+"/agents/{agentID}", service.GetAgent())
	s.Router.Put(prefix+"/agents/{agentID}", service.UpdateAgent())
	s.Router.Delete(prefix+"/agents/{agentID}", service.DeleteAgent())
	s.Router.Get(prefix+"/agents/{agentID}/members", service.Members())
	s.Router.Put(prefix+"/agents/{agentID}/members", service.Members())
	s.Router.Get(prefix+"/agents/{agentID}/triggers", service.Triggers())
	s.Router.Put(prefix+"/agents/{agentID}/triggers", service.Triggers())
	s.Router.Post(prefix+"/agents/{agentID}/jobs", service.CreateJob())
	s.Router.Get(prefix+"/agents/jobs", service.Jobs())
	s.Router.Get(prefix+"/agents/jobs/{jobID}", service.GetJob())
	s.Router.Post(prefix+"/agents/jobs/{jobID}/cancel", service.CancelJob())
	s.Router.Post(prefix+"/agents/jobs/{jobID}/retry", service.RetryJob())
	s.Router.Post(prefix+"/agents/jobs/{jobID}/approvals", service.CreateApproval())
	s.Router.Get(prefix+"/agents/approvals", service.Approvals())
	s.Router.Post(prefix+"/agents/approvals/{approvalID}/decision", service.DecideApproval())
	s.Router.Post(prefix+"/agents/approvals/{approvalID}/resolve", service.DecideApproval())
}

func serverFeatureEnabled(name string) bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(name)), "true")
}

func agentAttachmentStoreFromEnv() (api.AgentAttachmentStore, error) {
	storeName := strings.ToLower(strings.TrimSpace(os.Getenv("DOCUMENT_STORE")))
	switch storeName {
	case "memory":
		if strings.EqualFold(strings.TrimSpace(os.Getenv("MISTY_ENVIRONMENT")), "production") {
			return nil, fmt.Errorf("DOCUMENT_STORE=memory is not allowed in production")
		}
		return api.NewMemoryAgentAttachmentStore(), nil
	case "r2", "s3":
		lifecycleDays, err := strconv.Atoi(strings.TrimSpace(os.Getenv("S3_LIFECYCLE_DAYS")))
		if err != nil {
			return nil, fmt.Errorf("S3_LIFECYCLE_DAYS must be an integer between 1 and 2")
		}
		endpoint := strings.TrimSpace(os.Getenv("S3_ENDPOINT"))
		region := strings.TrimSpace(os.Getenv("S3_REGION"))
		forcePathStyle := serverFeatureEnabled("S3_FORCE_PATH_STYLE")
		if storeName == "r2" {
			if endpoint == "" {
				return nil, fmt.Errorf("S3_ENDPOINT is required for Cloudflare R2")
			}
			if region == "" {
				region = "auto"
			}
			// R2 supports path-style S3 requests, which avoid placing a user
			// supplied bucket name into the endpoint hostname.
			forcePathStyle = true
		}
		store, err := api.NewS3AgentAttachmentStore(api.S3AgentAttachmentStoreConfig{
			Endpoint:           endpoint,
			Region:             region,
			Bucket:             os.Getenv("S3_BUCKET"),
			AccessKeyID:        os.Getenv("S3_ACCESS_KEY"),
			SecretAccessKey:    os.Getenv("S3_SECRET_KEY"),
			ForcePathStyle:     forcePathStyle,
			BucketPrivate:      serverFeatureEnabled("S3_PRIVATE"),
			LifecycleMaxDays:   lifecycleDays,
			AllowInsecureLocal: !strings.EqualFold(strings.TrimSpace(os.Getenv("MISTY_ENVIRONMENT")), "production") && serverFeatureEnabled("S3_ALLOW_INSECURE_LOCAL"),
		})
		if err != nil {
			return nil, fmt.Errorf("configure %s agent attachment store: %w", storeName, err)
		}
		return store, nil
	case "":
		return nil, fmt.Errorf("DOCUMENT_STORE is required when MISTY_AGENT_DOCUMENTS_ENABLED=true")
	default:
		return nil, fmt.Errorf("unsupported DOCUMENT_STORE %q (expected r2, s3, or development-only memory)", storeName)
	}
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

func (s *Server) mountAIRoutes(prefix string, aiService *api.AIService) {
	s.Router.Get(prefix+"/status", aiService.Status())
	s.Router.Post(prefix+"/complete", aiService.Complete())
	s.Router.Post(prefix+"/sessions", aiService.CreateSession())
	s.Router.Post(prefix+"/sessions/{sessionID}/messages", aiService.SendMessage())
	s.Router.Get(prefix+"/sessions/{sessionID}/events", aiService.Events())
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
