use std::io::{Read, Write};

use page_text::protocol::{answer, MAX_INPUT_BYTES};

#[cfg(debug_assertions)]
mod probe;

fn run() -> Result<(), std::io::Error> {
    let mut input = Vec::new();
    std::io::stdin().take(MAX_INPUT_BYTES as u64 + 1).read_to_end(&mut input)?;
    if input.len() > MAX_INPUT_BYTES {
        return Err(std::io::Error::other("input exceeds the worker's limit"));
    }
    #[cfg(debug_assertions)]
    if let Some(reply) = probe::run(&input) {
        return std::io::stdout().write_all(reply.as_bytes());
    }
    std::io::stdout().write_all(&answer(&input))
}

fn main() {
    if run().is_err() {
        std::process::exit(1);
    }
}
