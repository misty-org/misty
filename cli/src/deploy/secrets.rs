//! Production and staging secrets generated on this computer.

use super::*;

/// Fills in missing production values without changing any existing one.
pub fn initialize_production_secrets(workspace: &Workspace) -> Result<()> {
    environment::init(workspace, Target::Prod)?;
    let existing = environment::read(workspace, Target::Prod)?;
    let missing = |name: &str| {
        existing
            .get(name)
            .is_none_or(|value| value.trim().is_empty())
    };
    let generated: [(&str, String); 15] = [
        ("MISTY_ENVIRONMENT", "production".into()),
        ("TRUST_PROXY_HEADERS", "true".into()),
        ("DB_HOST", "postgres".into()),
        ("DB_NAME", "misty_server".into()),
        ("DB_USER", "misty_app".into()),
        ("DB_MIGRATION_USER", "misty".into()),
        ("DB_PASSWORD", hex_secret()),
        ("DB_MIGRATION_PASSWORD", hex_secret()),
        ("AGENT_RUNTIME_DB_PASSWORD", hex_secret()),
        ("MISTY_AUTH_SIGNING_KEY", base64_secret()),
        ("MISTY_AGENT_RUNTIME_CONTROL_SECRET", base64_secret()),
        ("SPACE_LINK_ENCRYPTION_KEY", base64_secret()),
        ("MISTY_BILLING_ADAPTER", "http".into()),
        ("MISTY_BILLING_SECRET", hex_secret()),
        ("MISTY_HOST_PORT", "8081".into()),
    ];
    let mut added = Vec::new();
    for (name, value) in generated {
        if missing(name) {
            environment::set(workspace, Target::Prod, name, &value)?;
            added.push(name);
        }
    }
    let prod = environment::root(workspace, Target::Prod);
    if server::ensure_connected_devices_development_config(&prod.join("crypto/devices.env"))? {
        added.push("MISTY_DEVICE_TICKET_PRIVATE_KEY, MISTY_DEVICE_PAIRING_PEPPER");
    }
    if missing("JOURNAL_COLLAB_TICKET_PRIVATE_KEY") {
        server::generate_production_worker_secrets(workspace)?;
        added.push("JOURNAL_COLLAB_* keys");
    }
    for name in &added {
        println!("  generated {name}");
    }
    let secret = environment::read(workspace, Target::Prod)?
        .remove("MISTY_BILLING_SECRET")
        .context("MISTY_BILLING_SECRET was not saved")?;
    initialize_billing_environment(workspace, &secret)?;
    println!(
        "Production secrets are in server/.env/prod. Still to fill in: MISTY_API_IMAGE, \
MISTY_AGENT_RUNTIME_IMAGE, MISTY_PUBLIC_API_URL (or run misty setup cloudflare --target prod), \
MISTY_BILLING_URL, R2_*, MISTY_BACKUP_*, and any integrations. Check with: misty env status prod"
    );
    Ok(())
}

/// Initializes isolated, local-image staging configuration without touching dev or prod.
pub fn initialize_staging_secrets(workspace: &Workspace) -> Result<()> {
    environment::init(workspace, Target::Staging)?;
    let existing = environment::read(workspace, Target::Staging)?;
    let missing = |name: &str| {
        existing
            .get(name)
            .is_none_or(|value| value.trim().is_empty())
    };
    let generated = [
        ("MISTY_ENVIRONMENT", "staging".to_owned()),
        ("DB_HOST", "postgres".to_owned()),
        ("DB_NAME", "misty_staging".to_owned()),
        ("DB_USER", "misty_app".to_owned()),
        ("DB_MIGRATION_USER", "misty".to_owned()),
        ("DB_PASSWORD", hex_secret()),
        ("DB_MIGRATION_PASSWORD", hex_secret()),
        ("AGENT_RUNTIME_DB_PASSWORD", hex_secret()),
        ("MISTY_AUTH_SIGNING_KEY", base64_secret()),
        ("MISTY_AGENT_RUNTIME_CONTROL_SECRET", base64_secret()),
        ("SPACE_LINK_ENCRYPTION_KEY", base64_secret()),
        ("MISTY_API_IMAGE", "misty-api:staging".to_owned()),
        (
            "MISTY_AGENT_RUNTIME_IMAGE",
            "misty-agent-runtime:staging".to_owned(),
        ),
        ("MISTY_PUBLIC_API_URL", "http://api:8080/v1".to_owned()),
        ("MISTY_HOST_PORT", "8082".to_owned()),
        ("MISTY_BILLING_ADAPTER", "none".to_owned()),
    ];
    let mut added = Vec::new();
    for (name, value) in generated {
        if missing(name) {
            environment::set(workspace, Target::Staging, name, &value)?;
            added.push(name);
        }
    }
    let staging = environment::root(workspace, Target::Staging);
    if server::ensure_connected_devices_development_config(&staging.join("crypto/devices.env"))? {
        added.push("MISTY_DEVICE_TICKET_PRIVATE_KEY, MISTY_DEVICE_PAIRING_PEPPER");
    }
    for name in added {
        println!("  generated {name}");
    }
    println!(
        "Initialized private staging configuration in {}. Add provider credentials only if the staging tests need them.",
        staging.display()
    );
    Ok(())
}

/// Writes misty-billing/.env/prod/billing.env beside this checkout, sharing the
/// adapter secret, and adds only values that are missing.
pub(super) fn initialize_billing_environment(workspace: &Workspace, secret: &str) -> Result<()> {
    let billing = workspace.root.join("misty-billing");
    if !billing.is_dir() {
        println!("misty-billing is not checked out beside misty; create its .env/prod/billing.env by hand.");
        return Ok(());
    }
    let path = billing.join(".env/prod/billing.env");
    let mut contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(error).with_context(|| format!("could not read {}", path.display()))
        }
    };
    let configured = |contents: &str, name: &str| {
        contents
            .lines()
            .any(|line| line.trim_start().starts_with(&format!("{name}=")))
    };
    if configured(&contents, "MISTY_BILLING_SECRET")
        && !contents
            .lines()
            .any(|line| line.trim() == format!("MISTY_BILLING_SECRET={secret}"))
    {
        bail!(
            "{} has a different MISTY_BILLING_SECRET than server/.env/prod; make them match",
            path.display()
        );
    }
    let mut added = Vec::new();
    for (name, value) in [
        ("BILLING_OWNER_PASSWORD", hex_secret()),
        ("BILLING_RUNTIME_PASSWORD", hex_secret()),
        ("MISTY_BILLING_SECRET", secret.to_owned()),
        ("MISTY_BILLING_IMAGE", String::new()),
    ] {
        if !configured(&contents, name) {
            if !contents.is_empty() && !contents.ends_with('\n') {
                contents.push('\n');
            }
            contents.push_str(&format!("{name}={value}\n"));
            added.push(name);
        }
    }
    if added.is_empty() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        }
    }
    write_private(&path, contents.as_bytes())?;
    println!(
        "  misty-billing/.env/prod/billing.env: added {}",
        added.join(", ")
    );
    Ok(())
}

pub(super) fn hex_secret() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn base64_secret() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    STANDARD.encode(bytes)
}
