//! Development journal-collab Worker secrets, kept in the development crypto/journal.env.

use super::*;

pub fn generate_worker_secrets(workspace: &Workspace) -> Result<()> {
    let path = journal_environment(workspace);
    let contents = read_journal_environment(&path)?;
    if !environment_values(&contents, TICKET_PRIVATE_KEY).is_empty() {
        bail!("Worker keys already exist in {}; use misty setup server to validate them without rotating keys", path.display());
    }
    let mut random = OsRng;
    let secrets = JournalSecrets::generate(&mut random)?;
    append_private(&path, &contents, &secrets.environment())?;
    ensure_room_salt(&path, &mut random)?;

    println!("Wrote the Worker secrets to {}.", path.display());
    println!("The private signing key was not printed.");
    println!("Deploy the Worker with `misty server deploy` after Cloudflare setup.");
    Ok(())
}

/// Generates what is missing and never replaces a key.
pub(super) fn ensure_worker_secrets(workspace: &Workspace) -> Result<()> {
    let path = journal_environment(workspace);
    let contents = read_journal_environment(&path)?;
    let Some(encoded) = environment_values(&contents, TICKET_PRIVATE_KEY)
        .first()
        .copied()
    else {
        return generate_worker_secrets(workspace);
    };
    if environment_values(&contents, TICKET_PUBLIC_KEY).is_empty() {
        let signing = SigningKey::from_pkcs8_der(&STANDARD.decode(encoded)?)?;
        let public = STANDARD.encode(VerifyingKey::from(&signing).to_bytes());
        append_private(&path, &contents, &format!("{TICKET_PUBLIC_KEY}={public}\n"))?;
    }
    ensure_room_salt(&path, &mut OsRng)
}

fn journal_environment(workspace: &Workspace) -> std::path::PathBuf {
    environment::root(workspace).join("crypto/journal.env")
}

fn read_journal_environment(path: &Path) -> Result<String> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error).with_context(|| format!("could not read {}", path.display())),
    }
}

fn append_private(path: &Path, contents: &str, addition: &str) -> Result<()> {
    let mut updated = contents.to_owned();
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push_str(addition);
    write_private(path, updated.as_bytes())
}
