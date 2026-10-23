//! Validation of the production Worker bundle, name and hostname.

use super::*;

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
