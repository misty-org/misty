use std::{env, fs};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{pkcs8::EncodePrivateKey, SigningKey, VerifyingKey};
use rand::{rngs::OsRng, RngCore};
use serde_json::json;
use url::Url;

use crate::{artifacts::write_private, process::CommandSpec, workspace::Workspace};

pub fn up(workspace: &Workspace, detach: bool, build: bool) -> Result<()> {
    let mut command = CommandSpec::new("docker").args(["compose", "up"]);
    if build {
        command = command.arg("--build");
    }
    if detach {
        command = command.arg("--detach");
    }
    command.run(&workspace.server)
}

pub fn down(workspace: &Workspace, volumes: bool) -> Result<()> {
    let mut command = CommandSpec::new("docker").args(["compose", "down"]);
    if volumes {
        command = command.arg("--volumes");
    }
    command.run(&workspace.server)
}

pub fn logs(workspace: &Workspace) -> Result<()> {
    CommandSpec::new("docker")
        .args(["compose", "logs", "--follow"])
        .run(&workspace.server)
}

pub fn build_image(workspace: &Workspace, tag: &str) -> Result<()> {
    if tag.trim().is_empty() {
        bail!("image tag cannot be empty");
    }
    CommandSpec::new("docker")
        .args(["build", "--tag", tag, "."])
        .run(&workspace.server)
}

pub fn generate_worker_secrets(workspace: &Workspace) -> Result<()> {
    let worker = workspace.server.join("cloudflare/journal-collab");
    let mut random = OsRng;
    let signing = SigningKey::generate(&mut random);
    verify_pair(&signing)?;
    let private = signing.to_pkcs8_der()?.as_bytes().to_vec();
    let public = VerifyingKey::from(&signing).to_bytes();
    let control = random_secret(&mut random);
    let projection = random_secret(&mut random);
    let room_salt = random_secret(&mut random);

    let dev_vars = format!(
        "JOURNAL_COLLAB_TICKET_PUBLIC_KEY={}\nJOURNAL_COLLAB_CONTROL_SECRET={control}\nJOURNAL_COLLAB_PROJECTION_SECRET={projection}\n",
        STANDARD.encode(public)
    );
    write_private(&worker.join(".dev.vars"), dev_vars.as_bytes())?;

    let server_env = format!(
        "# Append to the Misty server environment.\n\
         # The private signing key must never be sent to Cloudflare.\n\
         JOURNAL_COLLAB_TICKET_PRIVATE_KEY={}\n\
         JOURNAL_COLLAB_CONTROL_SECRET={control}\n\
         JOURNAL_COLLAB_PROJECTION_SECRET={projection}\n\
         # Keep the room salt stable across signing-key rotations.\n\
         JOURNAL_COLLAB_ROOM_SALT={room_salt}\n",
        STANDARD.encode(private)
    );
    write_private(&worker.join(".secrets/server.env"), server_env.as_bytes())?;

    println!("Wrote Cloudflare local secrets to:");
    println!("  {}", worker.join(".dev.vars").display());
    println!("  {}", worker.join(".secrets/server.env").display());
    println!("The private signing key was not printed.");
    println!("Set the three public Worker values with `wrangler secret put`.");
    Ok(())
}

pub fn configure_r2_cors(workspace: &Workspace, apply: bool) -> Result<()> {
    let bucket = required_environment("R2_BUCKET")?;
    let raw_origins = required_environment("MISTY_R2_ALLOWED_ORIGINS")?;
    let mut origins = raw_origins
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    origins.sort();
    let original_count = origins.len();
    origins.dedup();
    if origins.is_empty() || origins.len() != original_count {
        bail!("MISTY_R2_ALLOWED_ORIGINS must contain unique comma-separated origins");
    }
    for origin in &origins {
        validate_r2_origin(origin)?;
    }
    let policy = json!({
        "rules": [{
            "allowed": {
                "origins": origins,
                "methods": ["GET", "HEAD", "PUT"],
                "headers": [
                    "content-type",
                    "x-amz-checksum-sha256",
                    "x-amz-meta-misty-library-sha256"
                ]
            },
            "exposeHeaders": ["etag", "x-amz-checksum-sha256"],
            "maxAgeSeconds": 3600
        }]
    });
    if !apply {
        println!("{}", serde_json::to_string_pretty(&policy)?);
        println!("Dry run only. Pass --apply to update bucket {bucket}.");
        return Ok(());
    }

    let temporary = tempfile::Builder::new()
        .prefix("misty-r2-cors-")
        .tempdir()?;
    let policy_path = temporary.path().join("cors.json");
    fs::write(&policy_path, serde_json::to_vec_pretty(&policy)?)?;
    let worker = workspace.server.join("cloudflare/journal-collab");
    let wrangler = worker.join("node_modules/.bin").join(if cfg!(windows) {
        "wrangler.cmd"
    } else {
        "wrangler"
    });
    CommandSpec::new(wrangler.as_os_str())
        .args(["r2", "bucket", "cors", "set"])
        .arg(&bucket)
        .arg("--file")
        .arg(policy_path.as_os_str())
        .arg("--force")
        .run(&worker)?;
    CommandSpec::new(wrangler.as_os_str())
        .args(["r2", "bucket", "cors", "list"])
        .arg(&bucket)
        .run(&worker)
}

fn verify_pair(signing: &SigningKey) -> Result<()> {
    use ed25519_dalek::{Signer, Verifier};
    let probe = b"misty-journal-collab-keycheck";
    let signature = signing.sign(probe);
    VerifyingKey::from(signing)
        .verify(probe, &signature)
        .context("generated Ed25519 keypair failed verification")
}

fn random_secret(random: &mut OsRng) -> String {
    let mut bytes = [0_u8; 32];
    random.fill_bytes(&mut bytes);
    STANDARD.encode(bytes)
}

fn required_environment(name: &str) -> Result<String> {
    let value = env::var(name).unwrap_or_default();
    let value = value.trim();
    if value.is_empty() {
        bail!("{name} is required");
    }
    Ok(value.to_owned())
}

fn validate_r2_origin(raw: &str) -> Result<()> {
    if raw.contains('*') {
        bail!("wildcard R2 origin is forbidden: {raw}");
    }
    let value = Url::parse(raw).with_context(|| format!("invalid R2 origin: {raw}"))?;
    if !value.username().is_empty()
        || value.password().is_some()
        || !matches!(value.path(), "" | "/")
        || value.query().is_some()
        || value.fragment().is_some()
    {
        bail!("R2 origins must not contain credentials, paths, queries, or fragments: {raw}");
    }
    let approved = value.scheme() == "https"
        || (value.scheme() == "tauri" && value.host_str() == Some("localhost"))
        || (value.scheme() == "http"
            && matches!(
                value.host_str(),
                Some("localhost" | "127.0.0.1" | "tauri.localhost")
            ));
    if !approved {
        bail!("R2 origin must use HTTPS or be an approved local/Tauri origin: {raw}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn r2_origins_are_narrow() {
        assert!(validate_r2_origin("https://mistysys.com").is_ok());
        assert!(validate_r2_origin("tauri://localhost").is_ok());
        assert!(validate_r2_origin("https://mistysys.com/path").is_err());
        assert!(validate_r2_origin("https://*.mistysys.com").is_err());
    }
}
