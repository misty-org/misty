use std::io::{Read, Write};

fn main() {
    if let Err(error) = run() {
        eprintln!("Document worker failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    std::io::stdin().take(8193).read_to_end(&mut bytes)?;
    if bytes.len() > 8192 {
        return Err("Request exceeds worker limits.".into());
    }
    let request = serde_json::from_slice(&bytes)?;
    let response = documents_worker::process(&std::env::current_dir()?, request);
    let result = serde_json::to_vec(&response)?;
    if result.len() > 4 * 1024 * 1024 {
        return Err("Response exceeds worker limits.".into());
    }
    std::io::stdout().write_all(&result)?;
    Ok(())
}
