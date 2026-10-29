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
    let generated: [(&str, String); 13] = [
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
    println!(
        "Production secrets are in server/.env/prod. Still to fill in: MISTY_API_IMAGE, \
MISTY_AGENT_RUNTIME_IMAGE, MISTY_PUBLIC_API_URL (or run misty setup cloudflare --target prod), \
R2_*, MISTY_BACKUP_*, and any integrations. Check with: misty env status prod"
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
