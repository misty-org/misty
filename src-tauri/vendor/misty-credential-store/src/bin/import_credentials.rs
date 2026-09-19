use std::io::{self, Read};

fn main() {
    if let Err(error) = import() {
        eprintln!("Credential import failed: {error}");
        std::process::exit(1);
    }
}

fn import() -> io::Result<()> {
    let mut input = String::new();
    io::stdin()
        .take(4 * 1024 * 1024 + 1)
        .read_to_string(&mut input)?;
    if input.len() > 4 * 1024 * 1024 {
        return Err(io::Error::other("Input exceeds the credential size limit"));
    }
    let record: serde_json::Value = serde_json::from_str(&input)
        .map_err(|_| io::Error::other("Expected a credential JSON object"))?;
    let field = |name: &str| {
        record
            .get(name)
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| io::Error::other(format!("Missing {name} string")))
    };
    let service = field("service")?;
    let account = field("account")?;
    let value = field("value")?;
    if let Some(existing) = misty_credential_store::load(service, account)? {
        if existing != value {
            return Err(io::Error::other(
                "A different credential already exists; it was not overwritten",
            ));
        }
    } else {
        misty_credential_store::store(service, account, value)?;
    }
    eprintln!("Credential imported into Misty's local store.");
    Ok(())
}
