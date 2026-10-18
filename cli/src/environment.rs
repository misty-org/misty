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

mod registry;
use registry::*;
mod migrate;
pub use migrate::*;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Target {
    Dev,
    Staging,
    Prod,
}

impl Target {
    pub fn label(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Staging => "staging",
            Self::Prod => "prod",
        }
    }

    fn legacy_name(self) -> &'static str {
        match self {
            Self::Dev => ".env.dev",
            Self::Staging => ".env.staging",
            Self::Prod => ".env.prod",
        }
    }
}

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
    if target == Target::Staging {
        if spec.path == "storage.env" {
            return "# Private, staging-only Library files on this host.\nMISTY_LIBRARY_BACKEND=filesystem\nMISTY_LIBRARY_FILESYSTEM_DIR=/var/lib/misty/library\n".into();
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
    for target in [Target::Dev, Target::Staging, Target::Prod] {
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

    let billing = values
        .get("MISTY_BILLING_ADAPTER")
        .map(|s| s.trim())
        .unwrap_or("none");
    if target == Target::Prod && billing != "http" {
        bail!("Production requires MISTY_BILLING_ADAPTER=http");
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
            && matches!(
                url.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]" | "host.docker.internal")
            );
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
    if target == Target::Staging {
        if values.get("MISTY_ENVIRONMENT").map(String::as_str) != Some("staging") {
            bail!("staging environment must set MISTY_ENVIRONMENT=staging");
        }
        if let Some(port) = values.get("MISTY_HOST_PORT") {
            if port.parse::<u16>().ok().is_none_or(|p| p == 0) {
                bail!("MISTY_HOST_PORT must be a port between 1 and 65535");
            }
        }
        let placeholders = values
            .iter()
            .filter(|(_, value)| is_placeholder(value))
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>();
        if !placeholders.is_empty() {
            bail!(
                "staging environment contains placeholder values: {}",
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

/// Every variable accepted by a scoped server environment file.
pub fn registered_names() -> Vec<&'static str> {
    FILES
        .iter()
        .flat_map(|spec| spec.names.iter().copied())
        .collect()
}

fn cli_owner(name: &str) -> Result<&'static str> {
    if name.starts_with("TAURI_")
        || name.starts_with("APPLE_")
        || name.starts_with("WINDOWS_")
        || name.starts_with("MISTY_CODESIGN_")
        || name.starts_with("MISTY_NOTARY_")
        || matches!(name, "MISTY_RELEASE_API_URL" | "MISTY_RELEASE_WEB_URL")
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
            | "MISTY_DEPLOY_HOST"
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
        Target::Staging => STAGING_REQUIRED,
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
    #[cfg(windows)]
    if !misty_credential_store::is_private_file(path) {
        bail!("{} must be readable only by you", path.display());
    }
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
    // Everything below inherits the folder's owner-only access.
    #[cfg(windows)]
    misty_credential_store::restrict_private_directory(root)?;
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
    // Unix creates the temporary file private already.
    #[cfg(windows)]
    misty_credential_store::restrict_private_file(&path)?;
    Ok(())
}

/// The environment registry is shared by init, validation, setup and Compose.
/// Settings registry as JSON for the operator console's Configuration page.
pub fn schema_json() -> serde_json::Value {
    let entries = FILES
        .iter()
        .flat_map(|spec| {
            spec.names.iter().map(move |name| {
                serde_json::json!({
                    "file": spec.path,
                    "name": name,
                    "required": DEV_REQUIRED.contains(name)
                        || STAGING_REQUIRED.contains(name)
                        || PROD_REQUIRED.contains(name),
                })
            })
        })
        .collect::<Vec<_>>();
    serde_json::Value::Array(entries)
}

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
