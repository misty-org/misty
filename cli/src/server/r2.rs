//! R2 bucket CORS configuration and origin validation.

use super::*;

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
    let worker = workspace.server.join("apps/journal-collab");
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

pub(super) fn validate_r2_origin(raw: &str) -> Result<()> {
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
