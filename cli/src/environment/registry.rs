//! The development environment files and the names development requires.
//! A server is configured with the four files under ~/.misty/server/prod/ instead
//! (docs/self-hosting.md).

#[derive(Clone, Copy)]
pub(super) struct FileSpec {
    pub(super) path: &'static str,
    pub(super) names: &'static [&'static str],
}

pub(super) const FILES: &[FileSpec] = &[
    FileSpec {
        path: "runtime.env",
        names: &[
            "AUTH_HANDOFF_START_URL",
            // Bearer token of the operator account API (docs/cloud/README.md).
            "MISTY_OPERATOR_TOKEN",
            // Anyone may make an account (docs/self-hosting.md#accounts).
            "MISTY_OPEN_SIGNUP",
            // Only these emails may make an account or sign in (docs/self-hosting.md#accounts).
            "MISTY_ALLOWED_EMAILS",
            "MISTY_ALLOWED_ORIGINS",
            "MISTY_ENVIRONMENT",
            "MISTY_HOST_PORT",
            "MISTY_INSTANCE_NAME",
            "MISTY_PUBLIC_API_URL",
            // The website a development app links to (`misty desktop dev`).
            "MISTY_PUBLIC_URL",
            "MISTY_DEVICE_JOBS_ENABLED",
            "MISTY_WEBSITE_URL",
            "PORT",
            "TRUST_PROXY_HEADERS",
            "TRUSTED_PROXY_CIDRS",
            // No longer read: the server sends no email, so there are no
            // reset or invitation links to address. Kept so existing
            // development files still load.
            "PASSWORD_RESET_START_URL",
            "PASSWORD_RESET_URL",
            "MISTY_INVITATION_URL_BASE",
            // No longer read: agents and model calls run on the desktop
            // (docs/agents/runtime.md). Kept so existing development files
            // still load.
            "MISTY_AGENT_RUNTIME_URL",
            "MISTY_AGENT_RUNTIME_INTERNAL_API_URL",
            "MISTY_ALLOW_MODEL_OVERRIDE",
            "MISTY_AI_TOOL_RESULT_EVENTS",
        ],
    },
    FileSpec {
        path: "database.env",
        names: &[
            "DB_HOST",
            "DB_MIGRATION_PASSWORD",
            "DB_MIGRATION_USER",
            "DB_NAME",
            "DB_PASSWORD",
            "DB_PORT",
            "DB_SSLMODE",
            "DB_MAX_OPEN_CONNS",
            "DB_MAX_IDLE_CONNS",
            "DB_CONN_MAX_LIFETIME",
            "DB_CONN_MAX_IDLE_TIME",
            "DB_USER",
            // No longer read: there is no workflow database. Kept so existing
            // development files still load.
            "AGENT_RUNTIME_DB_PASSWORD",
        ],
    },
    FileSpec {
        path: "storage.env",
        names: &[
            "R2_ACCESS_KEY",
            "R2_BUCKET",
            "R2_ENDPOINT",
            "R2_SECRET_KEY",
            "MISTY_R2_ALLOWED_ORIGINS",
        ],
    },
    FileSpec {
        path: "observability.env",
        names: &[
            "MISTY_METRICS_TOKEN",
            "MISTY_RELEASE_CHANNEL",
            "MISTY_SERVER_VERSION",
        ],
    },
    FileSpec {
        path: "integrations/ai.env",
        names: &[
            // No longer read: every server has Memory. Kept so existing
            // development files still load.
            "MISTY_RECALL",
            "MISTY_RECALL_BACKLOG_CAP",
            // No longer read: web search runs on each device, on a search key
            // the person keeps there (docs/byok.md). Kept so existing
            // development files still load.
            "MISTY_SEARCH_PROVIDER",
            "MISTY_SEARCH_API_KEY",
            "MISTY_SERPER_API_KEY",
            // No longer read: the server calls no model and holds no model key;
            // each device brings its own (docs/byok.md). Kept so existing
            // development files still load.
            "AI_GATEWAY_API_KEY",
            "AI_GATEWAY_BASE_URL",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "CLAUDE_API_KEY",
            "NVIDIA_API_KEY",
            "NVIDIA_BASE_URL",
            "GEMINI_API_KEY",
            "GEMINI_BASE_URL",
            "GOOGLE_GENERATIVE_AI_API_KEY",
            "OPENAI_BASE_URL",
            "ANTHROPIC_BASE_URL",
            "OPENROUTER_API_KEY",
            "OPENROUTER_BASE_URL",
            "OLLAMA_BASE_URL",
            "OLLAMA_API_KEY",
            "OPENAI_COMPATIBLE_BASE_URL",
            "OPENAI_COMPATIBLE_API_KEY",
            "SONIOX_API_KEY",
            "MISTY_RUNTIME_LIVE_TRANSCRIBE",
            "ELEVENLABS_API_KEY",
            "MISTY_VOICE_ID",
            "MISTY_VOICE_TTS_MODEL",
            "AGENT_TRANSCRIPTION_MODEL",
            "MEDIA_SEARCH_TRANSCRIPTION_MODEL",
            "MEDIA_SEARCH_TRANSCRIPTION_FALLBACK_MODEL",
            "SMART_LIBRARY_EMBEDDING_MODEL",
            "SMART_LIBRARY_SEARCH_DAILY_LIMIT",
            "MISTY_AI_LOW_MODEL",
            "MISTY_AI_MODEL_CATALOG_JSON",
            "MISTY_AGENT_MODEL",
            "MISTY_AI_MAX_TOKENS_PER_DAY",
            "MISTY_AI_MAX_TOKENS_PER_HOUR",
            "VERCEL_OIDC_TOKEN",
        ],
    },
    FileSpec {
        path: "integrations/cloudflare.env",
        names: &[
            "CLOUDFLARE_ACCOUNT_ID",
            "CLOUDFLARE_ZONE_ID",
            "MISTY_CLOUDFLARE_TUNNEL_NAME",
            "CLOUDFLARE_API_TOKEN",
            "CLOUDFLARE_TUNNEL_TOKEN",
            "MISTY_CLOUDFLARE_WORKER_HOST",
            "MISTY_CLOUDFLARE_WORKER_NAME",
            "MISTY_DEV_ALLOWED_ORIGINS",
            "MISTY_DEV_API_ORIGIN",
            "MISTY_DEV_API_TUNNEL_HOSTNAME",
            "PARTYKIT_HOST",
        ],
    },
    FileSpec {
        path: "composio.env",
        names: &["COMPOSIO_API_KEY"],
    },
    FileSpec {
        path: "integrations/composio.env",
        // MISTY_COMPOSIO_DEPLOYMENT is no longer read; kept so existing
        // development files still load.
        names: &["MISTY_COMPOSIO_DEPLOYMENT", "MISTY_COMPOSIO_API_KEY"],
    },
    FileSpec {
        path: "integrations/google.env",
        names: &[
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "GOOGLE_SIGN_IN_REDIRECT_URL",
        ],
    },
    FileSpec {
        path: "integrations/microsoft.env",
        // No longer read; kept so existing development files still load.
        names: &["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    },
    FileSpec {
        path: "crypto/documents.env",
        names: &["DOCUMENT_SIGNING_KEY"],
    },
    FileSpec {
        path: "crypto/journal.env",
        names: &[
            "JOURNAL_COLLAB_CONTROL_SECRET",
            "JOURNAL_COLLAB_CONTROL_SECRET_PREVIOUS",
            "JOURNAL_COLLAB_PROJECTION_SECRET",
            "JOURNAL_COLLAB_PROJECTION_SECRET_PREVIOUS",
            "JOURNAL_COLLAB_ROOM_SALT",
            "JOURNAL_COLLAB_TICKET_PRIVATE_KEY",
            "JOURNAL_COLLAB_TICKET_PUBLIC_KEY",
        ],
    },
    FileSpec {
        path: "crypto/devices.env",
        names: &[
            "MISTY_DEVICE_PAIRING_PEPPER",
            "MISTY_DEVICE_TICKET_PREVIOUS_PUBLIC_KEYS",
            "MISTY_DEVICE_TICKET_PRIVATE_KEY",
        ],
    },
    FileSpec {
        path: "crypto/spaces.env",
        names: &["SPACE_LINK_ENCRYPTION_KEY"],
    },
    FileSpec {
        path: "crypto/services.env",
        names: &[
            "MISTY_AGENT_RUNTIME_CONTROL_SECRET",
            "MISTY_AGENT_RUNTIME_CONTROL_SECRET_PREVIOUS",
            "MISTY_AUTH_SIGNING_KEY",
            "MISTY_AUTH_SIGNING_KEY_PREVIOUS",
        ],
    },
];

pub(super) const DEV_REQUIRED: &[&str] = &[
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_TUNNEL_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "MISTY_DEV_API_ORIGIN",
    "MISTY_DEV_API_TUNNEL_HOSTNAME",
    "MISTY_CLOUDFLARE_WORKER_HOST",
];
