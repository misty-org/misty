use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use clap::ValueEnum;
use rand::{rngs::OsRng, RngCore};
use walkdir::WalkDir;

use crate::{artifacts::write_private, workspace::Workspace};

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Target {
    Dev,
    Prod,
}

impl Target {
    pub fn label(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Prod => "prod",
        }
    }

    fn legacy_name(self) -> &'static str {
        match self {
            Self::Dev => ".env.dev",
            Self::Prod => ".env.prod",
        }
    }
}

#[derive(Clone, Copy)]
struct FileSpec {
    path: &'static str,
    names: &'static [&'static str],
}

const FILES: &[FileSpec] = &[
    FileSpec {
        path: "runtime.env",
        names: &[
            "AUTH_HANDOFF_START_URL",
            "MISTY_AGENT_RUNTIME_IMAGE",
            "MISTY_AGENT_RUNTIME_INTERNAL_API_URL",
            "MISTY_AGENT_RUNTIME_URL",
            "MISTY_ALLOWED_ORIGINS",
            "MISTY_API_IMAGE",
            "MISTY_COLLAB_IMAGE",
            "MISTY_COLLAB_PUBLIC_URL",
            "MISTY_DEPLOYMENT_MODE",
            "MISTY_ENVIRONMENT",
            "MISTY_HOST_PORT",
            "MISTY_INSTANCE_NAME",
            "MISTY_PUBLIC_API_URL",
            "MISTY_SDK_EXECUTION_ENABLED",
            "MISTY_DEVICE_JOBS_ENABLED",
            "MISTY_WEBSITE_URL",
            "PASSWORD_RESET_START_URL",
            "PASSWORD_RESET_URL",
            "PORT",
            "TRUST_PROXY_HEADERS",
            "TRUSTED_PROXY_CIDRS",
            "MISTY_INVITATION_URL_BASE",
            "MISTY_AGENT_DOCUMENTS_ENABLED",
            "MISTY_SOCIAL_AUTOMATION_DISABLED",
            "MISTY_SOCIAL_DISCORD_DISABLED",
            "MISTY_SOCIAL_SEND_DISABLED",
        ],
    },
    FileSpec {
        path: "database.env",
        names: &[
            "AGENT_RUNTIME_DB_PASSWORD",
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
        ],
    },
    FileSpec {
        path: "storage.env",
        names: &[
            "MISTY_LIBRARY_BACKEND",
            "MISTY_LIBRARY_FILESYSTEM_DIR",
            "MISTY_S3_ACCESS_KEY_ID",
            "MISTY_S3_BUCKET",
            "MISTY_S3_ENDPOINT",
            "MISTY_S3_FORCE_PATH_STYLE",
            "MISTY_S3_REGION",
            "MISTY_S3_SECRET_ACCESS_KEY",
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
            "POSTHOG_PROJECT_TOKEN",
            "POSTHOG_HOST",
            "MISTY_RELEASE_CHANNEL",
            "MISTY_SERVER_VERSION",
        ],
    },
    FileSpec {
        path: "integrations/ai.env",
        names: &[
            "AI_GATEWAY_API_KEY",
            "MISTY_REALTIME_API_KEY",
            "AI_GATEWAY_BASE_URL",
            "AI_GATEWAY_EMBEDDING_BASE_URL",
            "AGENT_TRANSCRIPTION_MODEL",
            "MEDIA_SEARCH_EMERGENCY_DISABLE",
            "MEDIA_SEARCH_TRANSCRIPTION_MODEL",
            "MEDIA_SEARCH_TRANSCRIPTION_FALLBACK_MODEL",
            "SMART_LIBRARY_EMBEDDING_MODEL",
            "SMART_LIBRARY_PRIMARY_MODEL",
            "SMART_LIBRARY_FALLBACK_MODEL",
            "SMART_LIBRARY_EMERGENCY_DISABLE",
            "SMART_LIBRARY_SEARCH_EMERGENCY_DISABLE",
            "SMART_LIBRARY_SEARCH_DAILY_LIMIT",
            "MISTY_AI_PROVIDER",
            "MISTY_AI_MODEL",
            "MISTY_AI_LOW_MODEL",
            "MISTY_AI_MED_MODEL",
            "MISTY_AI_HIGH_MODEL",
            "MISTY_AI_MODEL_CATALOG_JSON",
            "OPENAI_BASE_URL",
            "GEMINI_AUTH_MODE",
            "GEMINI_BASE_URL",
            "GEMINI_OAUTH_SCOPE",
            "GEMINI_VERTEX_PROJECT",
            "GEMINI_VERTEX_LOCATION",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_CLOUD_REGION",
            "VISION_PROCESSOR_URL",
            "VISION_PROCESSOR_TOKEN",
            "MISTY_AGENT_MODEL_PROVIDER",
            "MISTY_AGENT_MODEL",
            "MISTY_AGENT_MODEL_API_KEY",
            "MISTY_AGENT_MODEL_BASE_URL",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "MISTY_AI_MAX_TOKENS_PER_DAY",
            "MISTY_AI_MAX_TOKENS_PER_HOUR",
            "OPENAI_API_KEY",
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
            "MISTY_DEV_TUNNEL_HOSTNAME",
            "PARTYKIT_HOST",
        ],
    },
    FileSpec {
        path: "integrations/billing.env",
        names: &[
            "MISTY_BILLING_ADAPTER",
            "MISTY_BILLING_URL",
            "MISTY_BILLING_SECRET",
        ],
    },
    FileSpec {
        path: "integrations/discord.env",
        names: &[
            "DISCORD_BOT_TOKEN",
            "DISCORD_GATEWAY_URL",
            "DISCORD_CLIENT_ID",
            "DISCORD_CLIENT_SECRET",
        ],
    },
    FileSpec {
        path: "integrations/dropbox.env",
        names: &["MISTY_DROPBOX_CLIENT_ID", "MISTY_DROPBOX_CLIENT_SECRET"],
    },
    FileSpec {
        path: "integrations/email.env",
        names: &[
            "MAILJET_API_KEY",
            "MAILJET_API_BASE_URL",
            "MAILJET_FROM_EMAIL",
            "MAILJET_FROM_NAME",
            "MAILJET_SECRET_KEY",
        ],
    },
    FileSpec {
        path: "integrations/figma.env",
        names: &[
            "FIGMA_CLIENT_ID",
            "FIGMA_CLIENT_SECRET",
            "FIGMA_API_BASE_URL",
        ],
    },
    FileSpec {
        path: "integrations/github.env",
        names: &[
            "GITHUB_APP_ID",
            "GITHUB_API_BASE_URL",
            "GITHUB_APP_PRIVATE_KEY",
            "GITHUB_APP_SLUG",
            "GITHUB_WEBHOOK_SECRET",
        ],
    },
    FileSpec {
        path: "integrations/google.env",
        names: &[
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "MISTY_GOOGLE_DRIVE_CLIENT_ID",
            "MISTY_GOOGLE_DRIVE_CLIENT_SECRET",
        ],
    },
    FileSpec {
        path: "integrations/instagram.env",
        names: &[
            "INSTAGRAM_APP_SECRET",
            "INSTAGRAM_CLIENT_ID",
            "INSTAGRAM_CLIENT_SECRET",
            "INSTAGRAM_GRAPH_API_BASE_URL",
            "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
        ],
    },
    FileSpec {
        path: "integrations/microsoft.env",
        names: &[
            "MICROSOFT_CLIENT_ID",
            "MICROSOFT_CLIENT_SECRET",
            "MISTY_ONEDRIVE_CLIENT_ID",
            "MISTY_ONEDRIVE_CLIENT_SECRET",
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
            "MISTY_AGENT_RUNTIME_CONTROL_SECRET",
            "MISTY_AGENT_RUNTIME_CONTROL_SECRET_PREVIOUS",
            "MISTY_AUTH_SIGNING_KEY",
            "MISTY_AUTH_SIGNING_KEY_PREVIOUS",
            "MISTY_COLLAB_INTERNAL_SECRET",
        ],
    },
];

// Accepted only when reading older environments; retired switches and settings
// must not block startup or become active configuration again.
const DEPRECATED_NAMES: &[&str] = &[
    "MISTY_LOCAL_WEBSITE_ORIGIN",
    "MISTY_CLOUDFLARE_TUNNEL_ID",
    "MISTY_CONNECTED_DEVICES_ENABLED",
    "MISTY_SDK_PROVIDERS_ENABLED",
    "WAITLIST_NOTIFY_EMAIL",
    "MISTY_OPERATOR_USER_ID",
    "DOCUMENT_KEY_ID",
    "DOCUMENT_PRIVATE_KEY_B64",
    "NOTION_CLIENT_ID",
    "NOTION_CLIENT_SECRET",
    "NOTION_WEBHOOK_LOG_VERIFICATION_TOKEN",
    "NOTION_WEBHOOK_VERIFICATION_TOKEN",
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_SIGNING_SECRET",
];

const DEPRECATED_CLI_NAMES: &[&str] = &[
    "MISTY_SOURCE_DIR",
    "MISTY_PROXY_SOURCE_DIR",
    "MISTY_HUB_SOURCE_DIR",
    "MISTY_RCLONE_SOURCE",
];

const PROD_REQUIRED: &[&str] = &[
    "DB_HOST",
    "DB_MIGRATION_PASSWORD",
    "DB_MIGRATION_USER",
    "DB_NAME",
    "DB_PASSWORD",
    "DB_USER",
    "MISTY_API_IMAGE",
    "MISTY_AUTH_SIGNING_KEY",
    "MISTY_DEVICE_PAIRING_PEPPER",
    "MISTY_DEVICE_TICKET_PRIVATE_KEY",
    "MISTY_ENVIRONMENT",
    "MISTY_PUBLIC_API_URL",
    "R2_ACCESS_KEY",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_SECRET_KEY",
    "SPACE_LINK_ENCRYPTION_KEY",
];

const DEV_REQUIRED: &[&str] = &[
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_TUNNEL_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "MISTY_DEV_API_ORIGIN",
    "MISTY_DEV_API_TUNNEL_HOSTNAME",
    "MISTY_CLOUDFLARE_WORKER_HOST",
];

pub fn root(workspace: &Workspace, target: Target) -> PathBuf {
    workspace.server.join(".env").join(target.label())
}

pub fn init(workspace: &Workspace, target: Target) -> Result<()> {
    let mut created = 0;
    for spec in FILES {
        let path = root(workspace, target).join(spec.path);
        if path.exists() {
            require_private_file(&path)?;
            continue;
        }
        let contents = initial_file_contents(*spec, target);
        if contents.is_empty() {
            continue;
        }
        write_private(&path, contents.as_bytes())?;
        created += 1;
    }
    fs::create_dir_all(root(workspace, target))?;
    secure_directories(&root(workspace, target))?;
    secure_directories(&workspace.server.join(".env"))?;
    init_cli_files(workspace)?;
    println!(
        "Initialized {} environment ({} new files).",
        target.label(),
        created
    );
    Ok(())
}

fn initial_file_contents(spec: FileSpec, target: Target) -> String {
    if target == Target::Dev {
        match spec.path {
            "runtime.env" => return "# Container development defaults.\nMISTY_ENVIRONMENT=development\nMISTY_HOST_PORT=8081\n".into(),
            "crypto/services.env" => { use base64::Engine; return format!("# Generated once; preserve across restarts.\nMISTY_AUTH_SIGNING_KEY={}\nMISTY_AGENT_RUNTIME_CONTROL_SECRET={}\n", base64::engine::general_purpose::STANDARD.encode(random_hex(32)), base64::engine::general_purpose::STANDARD.encode(random_hex(32))); },
            "database.env" => return format!("# Generated once; preserve these with the database volume.\nDB_USER=misty_app\nDB_NAME=misty_server\nDB_MIGRATION_USER=misty\nDB_PASSWORD={}\nDB_MIGRATION_PASSWORD={}\nAGENT_RUNTIME_DB_PASSWORD={}\n", random_hex(32), random_hex(32), random_hex(32)),
            _ => {}
        }
    }
    String::new()
}

fn random_hex(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn migrate(workspace: &Workspace) -> Result<()> {
    for target in [Target::Dev, Target::Prod] {
        migrate_server_file(workspace, target)?;
    }
    migrate_cli_file(workspace)?;
    println!("Environment migration complete.");
    Ok(())
}

pub fn validate(workspace: &Workspace, target: Target) -> Result<()> {
    read_cli_files(workspace)?;
    let values = effective(workspace, target)?;
    let missing = required(target)
        .iter()
        .filter(|name| {
            values
                .get(**name)
                .is_none_or(|value| value.trim().is_empty())
        })
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        bail!(
            "{} environment is missing required values: {}",
            target.label(),
            missing.join(", ")
        );
    }

    let deployment = values
        .get("MISTY_DEPLOYMENT_MODE")
        .map(|s| s.trim())
        .unwrap_or("self_hosted");
    let billing = values
        .get("MISTY_BILLING_ADAPTER")
        .map(|s| s.trim())
        .unwrap_or("none");
    if deployment == "hosted" && billing != "http" {
        bail!("Hosted deployment requires MISTY_BILLING_ADAPTER=http");
    }
    if !matches!(billing, "" | "none" | "null" | "http") {
        bail!("Unknown MISTY_BILLING_ADAPTER mode");
    }
    if billing == "http" {
        let raw = values
            .get("MISTY_BILLING_URL")
            .context("MISTY_BILLING_URL is required")?;
        let url = url::Url::parse(raw).context("Invalid MISTY_BILLING_URL")?;
        let local = target == Target::Dev
            && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "host.docker.internal"));
        if (url.scheme() != "https" && !(url.scheme() == "http" && local))
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            bail!("Billing URL requires HTTPS, except for the local development host");
        }
        if values
            .get("MISTY_BILLING_SECRET")
            .is_none_or(|secret| secret.len() < 32)
        {
            bail!("MISTY_BILLING_SECRET must contain at least 32 bytes");
        }
    }
    if target == Target::Dev {
        {
            let name = "MISTY_DEV_API_ORIGIN";
            let value = values.get(name).context("missing API origin")?;
            let url = url::Url::parse(value).context("API origin must be a valid HTTPS origin")?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !matches!(url.path(), "" | "/")
                || url.query().is_some()
                || url.fragment().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                bail!("{name} must be an HTTPS origin without a path or credentials");
            }
            if url.host_str()
                != values
                    .get("MISTY_DEV_API_TUNNEL_HOSTNAME")
                    .map(String::as_str)
            {
                bail!("API origin and tunnel hostname must match");
            }
        }
        if let Some(port) = values.get("MISTY_HOST_PORT") {
            if port.parse::<u16>().ok().is_none_or(|p| p == 0) {
                bail!("MISTY_HOST_PORT must be a port between 1 and 65535");
            }
        }
    }
    if target == Target::Prod {
        let placeholders = values
            .iter()
            .filter(|(_, value)| is_placeholder(value))
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>();
        if !placeholders.is_empty() {
            bail!(
                "prod environment contains placeholder values: {}",
                placeholders.join(", ")
            );
        }
    }
    Ok(())
}

pub fn check(workspace: &Workspace, target: Target) -> Result<()> {
    validate(workspace, target)?;
    println!("{} environment is valid.", target.label());
    Ok(())
}

pub fn status(workspace: &Workspace, target: Target) -> Result<()> {
    let values = read(workspace, target)?;
    println!("{} environment", target.label());
    for spec in FILES {
        println!("  {}", spec.path);
        for name in spec.names {
            let state = match values.get(*name) {
                Some(value) if !value.trim().is_empty() => "set",
                Some(_) => "empty",
                None => "unset",
            };
            println!("    {name:<48} {state}");
        }
    }
    let missing = required(target)
        .iter()
        .filter(|name| {
            values
                .get(**name)
                .is_none_or(|value| value.trim().is_empty())
        })
        .copied()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        println!("  required values                    ready");
    } else {
        println!(
            "  missing required                   {}",
            missing.join(", ")
        );
    }
    Ok(())
}

pub fn read(workspace: &Workspace, target: Target) -> Result<BTreeMap<String, String>> {
    let base = root(workspace, target);
    let known_files = FILES
        .iter()
        .map(|spec| base.join(spec.path))
        .collect::<BTreeSet<_>>();
    // Retired integration files may remain on upgraded installations. They are never loaded.
    let retired_files = [
        base.join("integrations/notion.env"),
        base.join("integrations/slack.env"),
    ];
    if base.exists() {
        for entry in WalkDir::new(&base).follow_links(false) {
            let entry = entry?;
            if entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "env")
                && !known_files.contains(entry.path())
                && !retired_files.iter().any(|path| path == entry.path())
            {
                bail!("unknown environment file: {}", entry.path().display());
            }
        }
    }

    let ownership = ownership()?;
    let mut values = BTreeMap::new();
    for spec in FILES {
        let path = base.join(spec.path);
        if !path.exists() {
            continue;
        }
        require_private_file(&path)?;
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("could not read {}", path.display()))?;
        for item in dotenvy::from_read_iter(contents.as_bytes()) {
            let (name, value) = item.map_err(|_| {
                anyhow::anyhow!("could not parse {} (values omitted)", path.display())
            })?;
            if DEPRECATED_NAMES.contains(&name.as_str()) {
                continue;
            }
            let expected = ownership
                .get(name.as_str())
                .with_context(|| format!("unknown environment variable {name}"))?;
            if *expected != spec.path {
                bail!(
                    "{name} belongs in {expected}, not {}",
                    path.strip_prefix(&base).unwrap_or(&path).display()
                );
            }
            if values.insert(name.clone(), value).is_some() {
                bail!(
                    "{name} is defined more than once in the {} environment",
                    target.label()
                );
            }
        }
    }
    Ok(values)
}

/// Values used by CLI validation and Compose interpolation; shell overrides files.
pub fn effective(workspace: &Workspace, target: Target) -> Result<BTreeMap<String, String>> {
    let mut values = read(workspace, target)?;
    for name in ownership()?.keys() {
        if let Ok(value) = env::var(name) {
            values.insert((*name).to_owned(), value);
        }
    }
    Ok(values)
}

pub fn apply(workspace: &Workspace, target: Target) -> Result<()> {
    for (name, value) in read(workspace, target)? {
        if env::var_os(&name).is_none() {
            env::set_var(name, value);
        }
    }
    Ok(())
}

pub fn legacy_path(workspace: &Workspace, target: Target) -> PathBuf {
    workspace.server.join(target.legacy_name())
}

pub fn owner(name: &str) -> Result<&'static str> {
    ownership()?
        .get(name)
        .copied()
        .with_context(|| format!("unknown environment variable {name}"))
}

fn migrate_server_file(workspace: &Workspace, target: Target) -> Result<()> {
    let legacy = legacy_path(workspace, target);
    if !legacy.is_file() {
        return Ok(());
    }
    let contents = fs::read_to_string(&legacy)
        .with_context(|| format!("could not read {}", legacy.display()))?;
    let mut grouped = BTreeMap::<&'static str, Vec<&str>>::new();
    let mut seen = BTreeSet::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (raw_name, _) = trimmed
            .split_once('=')
            .with_context(|| format!("unsupported line in {}", legacy.display()))?;
        let name = raw_name
            .trim()
            .strip_prefix("export ")
            .unwrap_or(raw_name.trim());
        if DEPRECATED_NAMES.contains(&name) {
            continue;
        }
        if !seen.insert(name.to_owned()) {
            bail!("{name} is defined more than once in {}", legacy.display());
        }
        grouped.entry(owner(name)?).or_default().push(line);
    }

    for &relative in grouped.keys() {
        let path = root(workspace, target).join(relative);
        if path.exists() {
            bail!(
                "migration would overwrite {}; merge it with {} before retrying",
                path.display(),
                legacy.display()
            );
        }
    }
    for spec in FILES {
        let path = root(workspace, target).join(spec.path);
        let lines = grouped.remove(spec.path).unwrap_or_default();
        if lines.is_empty() {
            continue;
        }
        let contents = format!("{}\n", lines.join("\n"));
        write_private(&path, contents.as_bytes())?;
    }
    fs::create_dir_all(root(workspace, target))?;
    secure_directories(&root(workspace, target))?;
    secure_directories(&workspace.server.join(".env"))?;
    read(workspace, target)?;
    fs::remove_file(&legacy)
        .with_context(|| format!("could not remove migrated file {}", legacy.display()))?;
    println!(
        "Migrated {} into .env/{}/.",
        legacy.display(),
        target.label()
    );
    Ok(())
}

fn migrate_cli_file(workspace: &Workspace) -> Result<()> {
    let legacy = workspace.cli.join(".env");
    if !legacy.is_file() {
        return Ok(());
    }
    let contents = fs::read_to_string(&legacy)
        .with_context(|| format!("could not read {}", legacy.display()))?;
    let next = workspace.cli.join(".env.next");
    if next.exists() {
        bail!(
            "temporary migration path already exists: {}",
            next.display()
        );
    }
    let mut grouped = BTreeMap::<&str, Vec<&str>>::new();
    let mut seen = BTreeSet::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (raw_name, _) = trimmed
            .split_once('=')
            .with_context(|| format!("unsupported line in {}", legacy.display()))?;
        let name = raw_name
            .trim()
            .strip_prefix("export ")
            .unwrap_or(raw_name.trim());
        if !seen.insert(name.to_owned()) {
            bail!("{name} is defined more than once in {}", legacy.display());
        }
        if DEPRECATED_CLI_NAMES.contains(&name) {
            continue;
        }
        grouped.entry(cli_owner(name)?).or_default().push(line);
    }
    fs::create_dir_all(&next)?;
    for name in ["common.env", "release.env", "cloudflare.env"] {
        let lines = grouped.remove(name).unwrap_or_default();
        if lines.is_empty() {
            continue;
        }
        let body = format!("{}\n", lines.join("\n"));
        write_private(&next.join(name), body.as_bytes())?;
    }
    secure_directories(&next)?;
    fs::remove_file(&legacy)?;
    fs::rename(&next, &legacy)?;
    println!("Migrated CLI configuration into misty/cli/.env/.");
    Ok(())
}

fn init_cli_files(workspace: &Workspace) -> Result<()> {
    let root = workspace.cli.join(".env");
    if root.is_file() {
        bail!(
            "legacy CLI environment must be migrated first: {}",
            root.display()
        );
    }
    for name in ["common.env", "release.env", "cloudflare.env"] {
        let path = root.join(name);
        if path.exists() {
            require_private_file(&path)?;
        }
    }
    if root.exists() {
        secure_directories(&root)?;
    }
    Ok(())
}

fn read_cli_files(workspace: &Workspace) -> Result<BTreeMap<String, String>> {
    read_selected_cli_files(workspace, &["common.env", "release.env", "cloudflare.env"])
}

pub fn read_selected_cli_files(
    workspace: &Workspace,
    files: &[&str],
) -> Result<BTreeMap<String, String>> {
    let root = workspace.cli.join(".env");
    if root.is_file() {
        bail!(
            "legacy CLI environment must be migrated first: {}",
            root.display()
        );
    }
    if root.is_dir() {
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|ext| ext == "env")
                && !["common.env", "release.env", "cloudflare.env"]
                    .contains(&entry.file_name().to_string_lossy().as_ref())
            {
                bail!("unknown CLI environment file: {}", entry.path().display());
            }
        }
    }
    let mut values = BTreeMap::new();
    for &file in files {
        let path = root.join(file);
        if !path.exists() {
            continue;
        }
        require_private_file(&path)?;
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("could not read {}", path.display()))?;
        for item in dotenvy::from_read_iter(contents.as_bytes()) {
            let (name, value) = item.map_err(|_| {
                anyhow::anyhow!("could not parse {} (values omitted)", path.display())
            })?;
            if DEPRECATED_CLI_NAMES.contains(&name.as_str()) {
                continue;
            }
            let expected = cli_owner(&name)?;
            if expected != file {
                bail!("{name} belongs in misty/cli/.env/{expected}, not misty/cli/.env/{file}");
            }
            if values.insert(name.clone(), value).is_some() {
                bail!("{name} is defined more than once in the CLI environment");
            }
        }
    }
    Ok(values)
}

fn cli_owner(name: &str) -> Result<&'static str> {
    if name.starts_with("TAURI_")
        || name.starts_with("APPLE_")
        || name.starts_with("WINDOWS_")
        || name.starts_with("MISTY_CODESIGN_")
        || name.starts_with("MISTY_NOTARY_")
    {
        return Ok("release.env");
    }
    if name.starts_with("CLOUDFLARE_")
        || name.starts_with("R2_")
        || name.starts_with("MISTY_CLOUDFLARE_")
        || name.starts_with("MISTY_R2_")
    {
        return Ok("cloudflare.env");
    }
    if matches!(
        name,
        "MISTY_ROOT"
            | "MISTY_ORG_ROOT"
            | "MISTY_DEV_SIGNING_IDENTITY"
            | "MISTY_DESKTOP_DEV_PORT"
            | "MISTY_DESKTOP_INITIAL_ROUTE"
    ) {
        return Ok("common.env");
    }
    bail!("unknown CLI environment variable {name}")
}

fn ownership() -> Result<BTreeMap<&'static str, &'static str>> {
    let mut result = BTreeMap::new();
    for spec in FILES {
        for name in spec.names {
            if let Some(previous) = result.insert(*name, spec.path) {
                bail!(
                    "environment schema assigns {name} to both {previous} and {}",
                    spec.path
                );
            }
        }
    }
    Ok(result)
}

fn required(target: Target) -> &'static [&'static str] {
    match target {
        Target::Dev => DEV_REQUIRED,
        Target::Prod => PROD_REQUIRED,
    }
}

fn is_placeholder(value: &str) -> bool {
    let value = value.trim();
    let lower = value.to_ascii_lowercase();
    !value.is_empty()
        && ((value.starts_with('<') && value.ends_with('>'))
            || lower.contains("replace-me")
            || lower.contains("replace-with")
            || matches!(lower.as_str(), "todo" | "tbd" | "changeme"))
}

fn require_private_file(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)?.permissions().mode() & 0o077;
        if mode != 0 {
            bail!(
                "{} must not be accessible by group or others",
                path.display()
            );
        }
    }
    Ok(())
}

fn secure_directories(root: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for entry in WalkDir::new(root).min_depth(0).follow_links(false) {
            let entry = entry?;
            if entry.file_type().is_dir() {
                fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o700))?;
            }
        }
    }
    Ok(())
}

/// Update one registered setting without printing its value or replacing other settings.
pub fn set(workspace: &Workspace, target: Target, name: &str, value: &str) -> Result<()> {
    if value.contains(['\n', '\r', '\0']) {
        bail!("environment values must be single-line");
    }
    let owners = ownership()?;
    let relative = owners.get(name).context("unknown environment setting")?;
    let path = root(workspace, target).join(relative);
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => {
            require_private_file(&path)?;
            contents
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    let mut lines: Vec<String> = contents
        .lines()
        .filter(|line| {
            line.split_once('=').is_none_or(|(key, _)| {
                key.trim()
                    .strip_prefix("export ")
                    .unwrap_or(key.trim())
                    .trim()
                    != name
            })
        })
        .map(str::to_owned)
        .collect();
    // Single quoting prevents dotenv expansion of dollar signs in credentials.
    if value.contains('\'') {
        bail!("environment values cannot contain a single quote");
    }
    lines.push(format!("{name}='{value}'"));
    fs::create_dir_all(path.parent().context("environment path has no parent")?)?;
    secure_directories(&workspace.server.join(".env"))?;
    use std::io::Write;
    let mut temporary =
        tempfile::NamedTempFile::new_in(path.parent().context("environment path has no parent")?)?;
    temporary.write_all(format!("{}\n", lines.join("\n")).as_bytes())?;
    temporary.as_file().sync_all()?;
    temporary.persist(&path).map_err(|e| e.error)?;
    Ok(())
}

/// The environment registry is shared by init, validation, setup and Compose.
pub fn describe() -> Result<()> {
    for spec in FILES {
        println!("{}", spec.path);
        for name in spec.names {
            println!(
                "  {name}{}",
                if DEV_REQUIRED.contains(name) {
                    " (required for development)"
                } else {
                    ""
                }
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_workspace(path: &Path) -> Workspace {
        Workspace {
            root: path.into(),
            misty: path.into(),
            server: path.join("server"),
            cli: path.join("cli"),
            website: path.join("website"),
            features: path.join("src/features"),
        }
    }

    #[test]
    fn cli_loader_enforces_ownership_and_ignores_retired_settings() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = fixture_workspace(tmp.path());
        let path = workspace.cli.join(".env/common.env");
        write_private(
            &path,
            b"MISTY_SOURCE_DIR=retired\nMISTY_DEV_SIGNING_IDENTITY=fixture\n",
        )
        .unwrap();
        let values = read_selected_cli_files(&workspace, &["common.env"]).unwrap();
        assert!(!values.contains_key("MISTY_SOURCE_DIR"));
        assert_eq!(values["MISTY_DEV_SIGNING_IDENTITY"], "fixture");
        write_private(&path, b"APPLE_SIGNING_IDENTITY=fixture\n").unwrap();
        assert!(read_selected_cli_files(&workspace, &["common.env"]).is_err());
        write_private(&path, b"MISTY_UNKNOWN_SETTING=fixture\n").unwrap();
        assert!(read_selected_cli_files(&workspace, &["common.env"]).is_err());
        write_private(
            &path,
            b"MISTY_DEV_SIGNING_IDENTITY=one\nMISTY_DEV_SIGNING_IDENTITY=two\n",
        )
        .unwrap();
        assert!(read_selected_cli_files(&workspace, &["common.env"]).is_err());
    }

    #[test]
    fn invalid_private_values_do_not_appear_in_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = fixture_workspace(tmp.path());
        for (path, cli) in [
            (
                root(&workspace, Target::Dev).join("integrations/ai.env"),
                false,
            ),
            (workspace.cli.join(".env/common.env"), true),
        ] {
            write_private(&path, b"INVALID KEY=private-fixture-token\n").unwrap();
            let result = if cli {
                read_cli_files(&workspace)
            } else {
                read(&workspace, Target::Dev)
            };
            let error = format!("{:#}", result.unwrap_err());
            assert!(!error.contains("private-fixture-token"));
        }
    }

    #[test]
    fn migration_never_overwrites_scoped_configuration() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = fixture_workspace(tmp.path());
        let scoped = root(&workspace, Target::Dev).join("crypto/services.env");
        write_private(&scoped, b"MISTY_AUTH_SIGNING_KEY=current\n").unwrap();
        let legacy = legacy_path(&workspace, Target::Dev);
        write_private(&legacy, b"MISTY_AUTH_SIGNING_KEY=old\nDB_NAME=legacy\n").unwrap();
        assert!(migrate_server_file(&workspace, Target::Dev).is_err());
        assert_eq!(
            fs::read_to_string(scoped).unwrap(),
            "MISTY_AUTH_SIGNING_KEY=current\n"
        );
        assert!(legacy.is_file());
        assert!(!root(&workspace, Target::Dev).join("database.env").exists());
    }

    #[test]
    fn set_replaces_export_assignments_without_creating_duplicates() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = fixture_workspace(tmp.path());
        let path = root(&workspace, Target::Dev).join("integrations/ai.env");
        write_private(&path, b"export OPENAI_API_KEY=old\n").unwrap();
        set(&workspace, Target::Dev, "OPENAI_API_KEY", "new-$literal").unwrap();
        assert_eq!(
            read(&workspace, Target::Dev).unwrap()["OPENAI_API_KEY"],
            "new-$literal"
        );
    }

    #[test]
    fn fresh_production_keys_need_no_placeholder_files_and_are_preserved() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = fixture_workspace(tmp.path());
        init(&workspace, Target::Prod).unwrap();
        crate::server::generate_production_worker_secrets(&workspace).unwrap();
        let first = read(&workspace, Target::Prod).unwrap();
        assert!(first.contains_key("JOURNAL_COLLAB_ROOM_SALT"));
        assert!(first.contains_key("JOURNAL_COLLAB_TICKET_PRIVATE_KEY"));
        assert!(crate::server::generate_production_worker_secrets(&workspace).is_err());
        assert_eq!(first, read(&workspace, Target::Prod).unwrap());
    }

    #[test]
    fn development_generation_preserves_keys_and_detects_api_overrides() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = fixture_workspace(tmp.path());
        init(&workspace, Target::Dev).unwrap();
        crate::server::initialize_development_secrets(&workspace).unwrap();
        let path = workspace
            .server
            .join("apps/journal-collab/.secrets/server.env");
        let original = fs::read(&path).unwrap();
        assert!(crate::server::generate_worker_secrets(&workspace).is_err());
        assert_eq!(fs::read(path).unwrap(), original);
        crate::server::validate_development_secrets(&workspace).unwrap();
        set(
            &workspace,
            Target::Dev,
            "JOURNAL_COLLAB_CONTROL_SECRET",
            "different",
        )
        .unwrap();
        assert!(crate::server::validate_development_secrets(&workspace).is_err());
    }

    #[test]
    fn every_name_has_one_owner() {
        let owners = ownership().unwrap();
        assert!(owners.len() > 80);
        assert_eq!(owners["DISCORD_BOT_TOKEN"], "integrations/discord.env");
        assert_eq!(owners["INSTAGRAM_APP_SECRET"], "integrations/instagram.env");

        assert_eq!(owners["JOURNAL_COLLAB_ROOM_SALT"], "crypto/journal.env");
        assert_eq!(owners["MISTY_AUTH_SIGNING_KEY"], "crypto/services.env");
        assert_eq!(
            owners["MISTY_AUTH_SIGNING_KEY_PREVIOUS"],
            "crypto/services.env"
        );
    }

    #[test]
    fn optional_files_are_created_only_when_configured() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = Workspace {
            root: tmp.path().to_path_buf(),
            misty: tmp.path().to_path_buf(),
            server: tmp.path().join("server"),
            cli: tmp.path().join("cli"),
            website: tmp.path().join("website"),
            features: tmp.path().join("src/features"),
        };
        init(&workspace, Target::Dev).unwrap();
        assert!(!workspace.cli.join(".env").exists());
        assert!(read_cli_files(&workspace).unwrap().is_empty());
        let integration = root(&workspace, Target::Dev).join("integrations/figma.env");
        assert!(!integration.exists());
        let before = read(&workspace, Target::Dev).unwrap();
        assert!(!before.contains_key("FIGMA_CLIENT_ID"));
        set(&workspace, Target::Dev, "FIGMA_CLIENT_ID", "fixture").unwrap();
        assert_eq!(
            read(&workspace, Target::Dev).unwrap()["FIGMA_CLIENT_ID"],
            "fixture"
        );
        fs::remove_file(integration).unwrap();
        init(&workspace, Target::Dev).unwrap();
        assert_eq!(read(&workspace, Target::Dev).unwrap(), before);
        let error = validate(&workspace, Target::Dev).unwrap_err().to_string();
        assert!(error.contains("missing required values"));
        assert!(error.contains("CLOUDFLARE_API_TOKEN"));
        init(&workspace, Target::Prod).unwrap();
        assert!(read(&workspace, Target::Prod).unwrap().is_empty());
    }

    #[test]
    fn retired_product_settings_do_not_block_or_enter_the_environment() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = Workspace {
            root: tmp.path().to_path_buf(),
            misty: tmp.path().to_path_buf(),
            server: tmp.path().join("server"),
            cli: tmp.path().join("cli"),
            website: tmp.path().join("website"),
            features: tmp.path().join("src/features"),
        };
        for target in [Target::Dev, Target::Prod] {
            init(&workspace, target).unwrap();
            let base = root(&workspace, target);
            assert!(!base.join("integrations/stripe.env").exists());
            assert!(!base.join("integrations/activepieces.env").exists());
            assert!(!base.join("integrations/notion.env").exists());
            assert!(!base.join("integrations/slack.env").exists());
            write_private(
                &base.join("integrations/notion.env"),
                b"NOTION_CLIENT_SECRET=retired\n",
            )
            .unwrap();
            write_private(
                &base.join("integrations/slack.env"),
                b"SLACK_SIGNING_SECRET=retired\n",
            )
            .unwrap();
            for (file, entry) in [
                ("runtime.env", "MISTY_SDK_PROVIDERS_ENABLED=true"),
                ("runtime.env", "MISTY_OPERATOR_USER_ID=retired"),
                ("crypto/documents.env", "DOCUMENT_PRIVATE_KEY_B64=retired"),
                (
                    "integrations/email.env",
                    "WAITLIST_NOTIFY_EMAIL=fixture@example.invalid",
                ),
            ] {
                let path = base.join(file);
                let contents = fs::read_to_string(&path).unwrap_or_default();
                write_private(&path, format!("{contents}\n{entry}\n").as_bytes()).unwrap();
            }
            let values = read(&workspace, target).unwrap();
            for name in DEPRECATED_NAMES {
                assert!(!values.contains_key(*name));
                assert!(owner(name).is_err());
            }
            let runtime = base.join("runtime.env");
            let contents = fs::read_to_string(&runtime).unwrap();
            write_private(
                &runtime,
                format!("{contents}\nMISTY_UNKNOWN_SETTING=true\n").as_bytes(),
            )
            .unwrap();
            assert!(read(&workspace, target)
                .unwrap_err()
                .to_string()
                .contains("MISTY_UNKNOWN_SETTING"));
        }
    }

    #[test]
    fn setup_is_idempotent_and_setting_values_stay_private() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = Workspace {
            root: tmp.path().to_path_buf(),
            misty: tmp.path().to_path_buf(),
            server: tmp.path().join("server"),
            cli: tmp.path().join("cli"),
            website: tmp.path().join("website"),
            features: tmp.path().join("src/features"),
        };
        init(&workspace, Target::Dev).unwrap();
        crate::server::initialize_development_secrets(&workspace).unwrap();
        crate::server::validate_development_secrets(&workspace).unwrap();
        let first = read(&workspace, Target::Dev).unwrap();
        let worker = workspace.server.join("apps/journal-collab/.dev.vars");
        let original_worker = fs::read(&worker).unwrap();
        fs::remove_file(&worker).unwrap();
        crate::server::initialize_development_secrets(&workspace).unwrap();
        assert_eq!(
            fs::read(&worker).unwrap(),
            original_worker,
            "interrupted setup must recover the same Worker keys"
        );

        set(
            &workspace,
            Target::Dev,
            "OPENAI_API_KEY",
            "test-$literal-secret",
        )
        .unwrap();
        init(&workspace, Target::Dev).unwrap();
        crate::server::initialize_development_secrets(&workspace).unwrap();
        let second = read(&workspace, Target::Dev).unwrap();
        assert_eq!(second["OPENAI_API_KEY"], "test-$literal-secret");
        for (name, value) in first {
            assert_eq!(second[&name], value, "{name} changed on rerun");
        }
        assert!(set(&workspace, Target::Dev, "UNKNOWN", "x").is_err());
        assert!(set(&workspace, Target::Dev, "OPENAI_API_KEY", "x\nINJECTED=bad").is_err());
        assert!(validate(&workspace, Target::Dev).is_err());
        for (key, val) in [
            ("CLOUDFLARE_API_TOKEN", "fixture"),
            ("CLOUDFLARE_TUNNEL_TOKEN", "fixture"),
            ("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef"),
            ("MISTY_CLOUDFLARE_WORKER_HOST", "fixture.workers.dev"),
            ("MISTY_DEV_API_ORIGIN", "https://api.example.com"),
            ("MISTY_DEV_API_TUNNEL_HOSTNAME", "api.example.com"),
        ] {
            set(&workspace, Target::Dev, key, val).unwrap();
        }
        validate(&workspace, Target::Dev).unwrap();
        set(
            &workspace,
            Target::Dev,
            "MISTY_DEV_API_ORIGIN",
            "https://api.example.com/v1",
        )
        .unwrap();
        assert!(validate(&workspace, Target::Dev).is_err());
    }
}
