//! Journal ticket keys and room salt.

use super::*;

pub(super) struct JournalSecrets {
    pub(super) private: String,
    pub(super) public: String,
    pub(super) control: String,
    pub(super) projection: String,
}

impl JournalSecrets {
    pub(super) fn generate(random: &mut OsRng) -> Result<Self> {
        let signing = SigningKey::generate(random);
        verify_pair(&signing)?;
        Ok(Self {
            private: STANDARD.encode(signing.to_pkcs8_der()?.as_bytes()),
            public: STANDARD.encode(VerifyingKey::from(&signing).to_bytes()),
            control: random_secret(random),
            projection: random_secret(random),
        })
    }

    pub(super) fn environment(&self) -> String {
        format!(
            "# The private signing key must never be sent to Cloudflare.\n\
         {TICKET_PRIVATE_KEY}={}\n\
         {TICKET_PUBLIC_KEY}={}\n\
         {CONTROL_SECRET}={}\n\
         {PROJECTION_SECRET}={}\n",
            self.private, self.public, self.control, self.projection
        )
    }
}

pub(super) fn ensure_room_salt(path: &std::path::Path, random: &mut OsRng) -> Result<()> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(error).with_context(|| format!("could not read {}", path.display()));
        }
    };
    let existing = environment_values(&contents, ROOM_SALT);
    if existing.len() > 1 {
        bail!(
            "{ROOM_SALT} is defined more than once in {}",
            path.display()
        );
    }
    if let Some(value) = existing.first() {
        let decoded = STANDARD
            .decode(value)
            .with_context(|| format!("{ROOM_SALT} in {} is not valid base64", path.display()))?;
        if decoded.len() < 32 {
            bail!(
                "{ROOM_SALT} in {} must contain at least 32 bytes",
                path.display()
            );
        }
        write_private(path, contents.as_bytes())?;
        return Ok(());
    }

    let mut updated = contents;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push_str(&format!("{ROOM_SALT}={}\n", random_secret(random)));
    write_private(path, updated.as_bytes())
}

pub(super) fn environment_values<'a>(contents: &'a str, name: &str) -> Vec<&'a str> {
    contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            (key.trim() == name).then(|| {
                value
                    .trim()
                    .trim_matches(|character| character == '"' || character == '\'')
            })
        })
        .collect()
}

pub(super) fn verify_pair(signing: &SigningKey) -> Result<()> {
    use ed25519_dalek::{Signer, Verifier};
    let probe = b"misty-journal-collab-keycheck";
    let signature = signing.sign(probe);
    VerifyingKey::from(signing)
        .verify(probe, &signature)
        .context("generated Ed25519 keypair failed verification")
}

pub(super) fn random_secret(random: &mut OsRng) -> String {
    let mut bytes = [0_u8; 32];
    random.fill_bytes(&mut bytes);
    STANDARD.encode(bytes)
}

pub(super) fn required_environment(name: &str) -> Result<String> {
    let value = env::var(name).unwrap_or_default();
    let value = value.trim();
    if value.is_empty() {
        bail!("{name} is required");
    }
    Ok(value.to_owned())
}
