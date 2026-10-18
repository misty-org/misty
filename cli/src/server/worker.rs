//! Journal-collab worker secrets and the production worker deploy.

use super::*;

pub fn build_image(workspace: &Workspace, tag: &str) -> Result<()> {
    if tag.trim().is_empty() {
        bail!("image tag cannot be empty");
    }
    CommandSpec::new("docker")
        .args(["build", "--tag", tag, "."])
        .run(&workspace.server)
}

pub fn generate_worker_secrets(workspace: &Workspace) -> Result<()> {
    let worker = workspace.server.join("apps/journal-collab");
    for path in [worker.join(".secrets/server.env"), worker.join(".dev.vars")] {
        if path.exists() {
            bail!("Worker keys already exist at {}; use misty setup server to validate or restore the bundle without rotating keys", path.display());
        }
    }
    let development_environment =
        environment::root(workspace, Target::Dev).join("crypto/journal.env");
    let mut random = OsRng;
    let secrets = JournalSecrets::generate(&mut random)?;
    ensure_room_salt(&development_environment, &mut random)?;

    let server_env = secrets.server_environment();
    write_private(&worker.join(".secrets/server.env"), server_env.as_bytes())?;
    restore_development_worker_secrets(
        &worker.join(".secrets/server.env"),
        &worker.join(".dev.vars"),
    )?;

    println!("Wrote Cloudflare local secrets to:");
    println!("  {}", worker.join(".dev.vars").display());
    println!("  {}", worker.join(".secrets/server.env").display());
    println!(
        "Kept the server room salt in {}.",
        development_environment.display()
    );
    println!("The private signing key was not printed.");
    println!("Deploy the Worker with `misty server deploy` after Cloudflare setup.");
    Ok(())
}

pub(super) fn restore_development_worker_secrets(server_path: &Path, worker_path: &Path) -> Result<()> {
    let values = read_environment(server_path)?;
    let encoded = values
        .get(TICKET_PRIVATE_KEY)
        .context("server ticket private key is missing")?;
    let signing = SigningKey::from_pkcs8_der(&STANDARD.decode(encoded)?)?;
    let secrets = JournalSecrets {
        private: encoded.clone(),
        public: STANDARD.encode(VerifyingKey::from(&signing).to_bytes()),
        control: values
            .get(CONTROL_SECRET)
            .context("server control secret is missing")?
            .clone(),
        projection: values
            .get(PROJECTION_SECRET)
            .context("server projection secret is missing")?
            .clone(),
    };
    write_private(worker_path, secrets.worker_environment().as_bytes())
}

pub fn generate_production_worker_secrets(workspace: &Workspace) -> Result<()> {
    let production_environment =
        environment::root(workspace, Target::Prod).join("crypto/journal.env");
    let worker_environment = workspace
        .server
        .join("apps/journal-collab/.secrets/worker.prod.env");
    let mut existing = match fs::read_to_string(&production_environment) {
        Ok(contents) => {
            require_private_file(&production_environment)?;
            contents
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    if worker_environment.exists() {
        bail!("production Worker keys already exist; restore the matching API bundle instead of rotating keys");
    }
    let mut random = OsRng;
    let secrets = JournalSecrets::generate(&mut random)?;
    for name in [TICKET_PRIVATE_KEY, CONTROL_SECRET, PROJECTION_SECRET] {
        if environment_values(&existing, name).is_empty() {
            existing.push_str(&format!("\n{name}=<generated>\n"));
        }
    }
    let mut updated =
        replace_production_secret_placeholders(&existing, &production_environment, &secrets)?;
    if environment_values(&updated, ROOM_SALT).is_empty() {
        updated.push_str(&format!("\n{ROOM_SALT}={}\n", random_secret(&mut random)));
    }
    validate_room_salt(&updated, &production_environment)?;

    // Preserve the Worker half if the server write fails. A subsequent attempt
    // refuses to overwrite it; restore/reconcile the partial bundle explicitly.
    write_private(&worker_environment, secrets.worker_environment().as_bytes())?;
    write_private(&production_environment, updated.as_bytes())?;

    println!("Configured first-use production Journal secrets:");
    println!("  server: {}", production_environment.display());
    println!("  Worker: {}", worker_environment.display());
    println!("The private signing key was not printed or sent to Cloudflare.");
    println!("Existing production room salt was preserved; a missing salt was generated.");
    println!(
        "Deploy the Worker values with Wrangler only after reviewing the production configuration."
    );
    Ok(())
}

pub fn deploy_production_worker(workspace: &Workspace, dry_run: bool) -> Result<()> {
    let production_environment =
        environment::root(workspace, Target::Prod).join("crypto/journal.env");
    let worker = workspace.server.join("apps/journal-collab");
    let worker_environment = worker.join(".secrets/worker.prod.env");
    require_private_file(&production_environment)?;
    require_private_file(&worker_environment)?;

    let production = environment::read(workspace, Target::Prod)?;
    let worker_secrets = read_environment(&worker_environment)?;
    validate_production_worker_bundle(
        &production,
        &production_environment,
        &worker_secrets,
        &worker_environment,
    )?;

    let token = env::var("CLOUDFLARE_API_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| production.get("CLOUDFLARE_API_TOKEN").cloned())
        .filter(|value| !value.trim().is_empty())
        .context("CLOUDFLARE_API_TOKEN is required for production Worker deployment")?;
    let worker_name = env::var("MISTY_CLOUDFLARE_WORKER_NAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| production.get("MISTY_CLOUDFLARE_WORKER_NAME").cloned())
        .unwrap_or_else(|| "misty-journal-collab".to_owned());
    validate_worker_name(&worker_name)?;
    validate_worker_hostname(&production, &worker_name)?;
    let api_base = required_map_value(&production, "MISTY_PUBLIC_API_URL")?;
    let api_url = Url::parse(api_base).context("MISTY_PUBLIC_API_URL is not a valid URL")?;
    if api_url.scheme() != "https" || api_url.host_str().is_none() {
        bail!("MISTY_PUBLIC_API_URL must be an absolute HTTPS URL");
    }

    let wrangler = worker.join("node_modules/.bin").join(if cfg!(windows) {
        "wrangler.cmd"
    } else {
        "wrangler"
    });
    if !wrangler.is_file() {
        bail!(
            "Wrangler is not installed at {}; run npm ci in {}",
            wrangler.display(),
            worker.display()
        );
    }

    let temporary = tempfile::Builder::new()
        .prefix("misty-worker-dry-run-")
        .tempdir()?;
    production_worker_deploy_command(
        &wrangler,
        &token,
        &worker_name,
        api_base,
        &worker_environment,
        true,
        Some(temporary.path()),
    )
    .run(&worker)?;
    if dry_run {
        println!("Production Worker dry run passed for {worker_name}.");
        return Ok(());
    }

    production_worker_deploy_command(
        &wrangler,
        &token,
        &worker_name,
        api_base,
        &worker_environment,
        false,
        None,
    )
    .run(&worker)?;
    CommandSpec::new(wrangler.as_os_str())
        .env("CLOUDFLARE_API_TOKEN", token)
        .args(["deployments", "list", "--name", worker_name.as_str()])
        .run(&worker)?;
    println!("Production Worker deployment completed and was verified.");
    Ok(())
}

pub(super) fn production_worker_deploy_command(
    wrangler: &Path,
    token: &str,
    worker_name: &str,
    api_base: &str,
    secrets_file: &Path,
    dry_run: bool,
    outdir: Option<&Path>,
) -> CommandSpec {
    let mut command = CommandSpec::new(wrangler.as_os_str())
        .env("CLOUDFLARE_API_TOKEN", token)
        .args(["deploy", "--name", worker_name])
        .arg("--var")
        .arg(format!("MISTY_INTERNAL_API_BASE:{api_base}"))
        .arg("--secrets-file")
        .arg(secrets_file.as_os_str());
    if dry_run {
        command = command.arg("--dry-run");
        if let Some(outdir) = outdir {
            command = command.arg("--outdir").arg(outdir.as_os_str());
        }
    }
    command
}

pub(super) fn validate_production_worker_bundle(
    production: &BTreeMap<String, String>,
    production_path: &Path,
    worker: &BTreeMap<String, String>,
    worker_path: &Path,
) -> Result<()> {
    let production_contents = fs::read_to_string(production_path)
        .with_context(|| format!("could not read {}", production_path.display()))?;
    validate_room_salt(&production_contents, production_path)?;

    let expected_worker_names = [TICKET_PUBLIC_KEY, CONTROL_SECRET, PROJECTION_SECRET];
    for name in &expected_worker_names {
        required_map_value(worker, name)?;
    }
    let unexpected = worker
        .keys()
        .filter(|name| !expected_worker_names.contains(&name.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !unexpected.is_empty() {
        bail!(
            "{} contains unexpected Worker secrets: {}",
            worker_path.display(),
            unexpected.join(", ")
        );
    }

    let private = STANDARD
        .decode(required_map_value(production, TICKET_PRIVATE_KEY)?)
        .context("production Journal ticket private key is not valid base64")?;
    let signing = SigningKey::from_pkcs8_der(&private)
        .context("production Journal ticket private key is not Ed25519 PKCS#8")?;
    let public = STANDARD
        .decode(required_map_value(worker, TICKET_PUBLIC_KEY)?)
        .context("production Worker ticket public key is not valid base64")?;
    if public.as_slice() != VerifyingKey::from(&signing).as_bytes() {
        bail!("production API private key does not match the Worker public key");
    }
    for name in [CONTROL_SECRET, PROJECTION_SECRET] {
        let server_value = required_map_value(production, name)?;
        let worker_value = required_map_value(worker, name)?;
        if server_value != worker_value {
            bail!("{name} does not match between the production API and Worker");
        }
        let decoded = STANDARD
            .decode(server_value)
            .with_context(|| format!("{name} is not valid base64"))?;
        if decoded.len() < 32 {
            bail!("{name} must contain at least 32 bytes");
        }
    }
    Ok(())
}

pub(super) fn read_environment(path: &Path) -> Result<BTreeMap<String, String>> {
    let contents =
        fs::read_to_string(path).with_context(|| format!("could not read {}", path.display()))?;
    let mut values = BTreeMap::new();
    for item in dotenvy::from_read_iter(contents.as_bytes()) {
        let (name, value) = item
            .map_err(|_| anyhow::anyhow!("could not parse {} (values omitted)", path.display()))?;
        if values.insert(name.clone(), value).is_some() {
            bail!("{name} is defined more than once in {}", path.display());
        }
    }
    Ok(values)
}

pub(super) fn required_map_value<'a>(values: &'a BTreeMap<String, String>, name: &str) -> Result<&'a str> {
    values
        .get(name)
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("{name} is required"))
}

pub(super) fn validate_worker_name(name: &str) -> Result<()> {
    let valid = !name.is_empty()
        && name.len() <= 63
        && !name.starts_with('-')
        && !name.ends_with('-')
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if !valid {
        bail!("invalid production Worker name: {name}");
    }
    Ok(())
}

pub(super) fn validate_worker_hostname(
    production: &BTreeMap<String, String>,
    worker_name: &str,
) -> Result<()> {
    let hostname = required_map_value(production, "PARTYKIT_HOST")?;
    if hostname.contains(['/', ':']) {
        bail!("PARTYKIT_HOST must be a bare hostname");
    }
    if hostname.ends_with(".workers.dev") && !hostname.starts_with(&format!("{worker_name}.")) {
        bail!("PARTYKIT_HOST does not match production Worker name {worker_name}");
    }
    Ok(())
}

pub(super) fn require_private_file(path: &Path) -> Result<()> {
    if !path.is_file() {
        bail!("required private file is missing: {}", path.display());
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
