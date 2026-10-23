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

mod files;
mod registry;
mod validate;
pub use files::*;
use registry::*;
pub use validate::*;
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
    if target == Target::Staging && spec.path == "storage.env" {
        return "# Private, staging-only Library files on this host.\nMISTY_LIBRARY_BACKEND=filesystem\nMISTY_LIBRARY_FILESYSTEM_DIR=/var/lib/misty/library\n".into();
    }
    String::new()
}

fn random_hex(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn read(workspace: &Workspace, target: Target) -> Result<BTreeMap<String, String>> {
    let base = root(workspace, target);
    let known_files = FILES
        .iter()
        .map(|spec| base.join(spec.path))
        .collect::<BTreeSet<_>>();
    if base.exists() {
        for entry in WalkDir::new(&base).follow_links(false) {
            let entry = entry?;
            if entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "env")
                && !known_files.contains(entry.path())
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
