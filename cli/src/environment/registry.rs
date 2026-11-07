//! The server settings files in ~/.misty/.env/server and the names each one owns. `misty.env` and
//! `mailjet.env` are also there, for a deployed server. The CLI leaves those
//! two alone, since the local server takes its address and origins from `runtime.env`.

#[derive(Clone, Copy)]
pub(super) struct FileSpec {
    pub(super) path: &'static str,
    pub(super) names: &'static [&'static str],
}

/// Files that belong in the folder and aren't the CLI's to read.
pub(super) const DEPLOYED_SERVER_FILES: [&str; 2] = ["misty.env", "mailjet.env"];
/// No longer read: Composio runs on the person's computer on their own key. Allowed so an existing
/// development folder still loads.
pub(super) const RETIRED_FILES: [&str; 1] = ["composio.env"];

pub(super) const FILES: &[FileSpec] = &[
    FileSpec {
        path: "runtime.env",
        names: &[
            "AUTH_HANDOFF_START_URL",
            // Bearer token of the operator account API.
            "MISTY_OPERATOR_TOKEN",
            // Anyone may make an account.
            "MISTY_OPEN_SIGNUP",
            // Only these emails may make an account or sign in.
            "MISTY_ALLOWED_EMAILS",
            "MISTY_ALLOWED_ORIGINS",
            "MISTY_ENVIRONMENT",
            "MISTY_HOST_PORT",
            "MISTY_INSTANCE_NAME",
            "MISTY_PUBLIC_API_URL",
            // The website a development app links to (`misty desktop dev`).
            "MISTY_PUBLIC_URL",
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
            // Kept so existing development files
            // still load.
            "MISTY_DEVICE_JOBS_ENABLED",
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
        path: "cloudflare.env",
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
        path: "google.env",
        names: &[
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "GOOGLE_SIGN_IN_REDIRECT_URL",
        ],
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
            "MISTY_AUTH_SIGNING_KEY",
            "MISTY_AUTH_SIGNING_KEY_PREVIOUS",
            // No longer read: a run has no server to sign its calls to. Kept so existing development
            // files still load.
            "MISTY_AGENT_RUNTIME_CONTROL_SECRET",
            "MISTY_AGENT_RUNTIME_CONTROL_SECRET_PREVIOUS",
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
