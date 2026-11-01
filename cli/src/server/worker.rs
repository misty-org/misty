//! Development journal-collab Worker secrets.

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

pub(super) fn restore_development_worker_secrets(
    server_path: &Path,
    worker_path: &Path,
) -> Result<()> {
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
