use std::io::{Read, Write};

fn main() {
    if let Err(error) = run() {
        eprintln!("Document worker failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    // The supervisor stages a single immutable input in this private directory.
    // One process handles one request, so no app/account state survives a run.
    let mut bytes = Vec::new();
    std::io::stdin().take(8193).read_to_end(&mut bytes)?;
    if bytes.len() > 8192 {
        return Err("Request exceeds worker limits.".into());
    }
    let request = serde_json::from_slice(&bytes)?;
    let response = misty_document_processing::process(&std::env::current_dir()?, request);
    let result = serde_json::to_vec(&response)?;
    if result.len() > 4 * 1024 * 1024 {
        return Err("Response exceeds worker limits.".into());
    }
    // stdout is a protocol channel. Diagnostics go only to stderr.
    std::io::stdout().write_all(&result)?;
    Ok(())
}
