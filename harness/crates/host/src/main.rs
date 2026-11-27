//! `harness-host`: a bare window with the system webview, driven by the agent page runtime.
//!
//! It loads a page, runs one runtime operation in the harness's own script world and prints the
//! answer as JSON:
//!
//! ```text
//! harness-host <url> [operation] [args-json] [--keep-open]
//! harness-host https://example.com
//! harness-host https://example.com find '{"query": "More information"}'
//! ```
//!
//! The default operation is `snapshot`. No DevTools protocol and no Playwright: the page is the
//! platform's own webview (WKWebView on macOS), reached through the same handle Misty's Tauri
//! windows use. It is the start of the host that benchmarks run on without the Misty app.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod scenario;

fn main() {
    #[cfg(target_os = "macos")]
    if let Err(error) = macos::run() {
        eprintln!("harness-host: {error}");
        std::process::exit(1);
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("harness-host runs on macOS for now; the WebKitGTK host comes next.");
        std::process::exit(2);
    }
}

/// What to load and which runtime operation to run there.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct Options {
    scenario: Option<std::path::PathBuf>,
    url: String,
    operation: String,
    args: serde_json::Value,
    keep_open: bool,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn options() -> Result<Options, String> {
    const USAGE: &str = "usage: harness-host <url> [operation] [args-json] [--keep-open]\n       harness-host --scenario <file.json> [--keep-open]";
    let mut keep_open = false;
    let mut positional = Vec::new();
    let mut args_in = std::env::args().skip(1);
    let mut scenario = None;
    while let Some(arg) = args_in.next() {
        match arg.as_str() {
            "--scenario" => scenario = Some(std::path::PathBuf::from(args_in.next().ok_or(USAGE)?)),
            "--keep-open" => keep_open = true,
            "-h" | "--help" => return Err(USAGE.into()),
            _ => positional.push(arg),
        }
    }
    if scenario.is_some() {
        return Ok(Options {
            scenario,
            url: String::new(),
            operation: String::new(),
            args: serde_json::json!({}),
            keep_open,
        });
    }
    let mut positional = positional.into_iter();
    let url = positional.next().ok_or(USAGE)?;
    let operation = positional.next().unwrap_or_else(|| "snapshot".into());
    let mut args = match positional.next() {
        Some(text) => serde_json::from_str(&text).map_err(|error| format!("args-json: {error}"))?,
        None => serde_json::json!({}),
    };
    if positional.next().is_some() {
        return Err(USAGE.into());
    }
    let object = args.as_object_mut().ok_or("args-json must be an object")?;
    // The runtime numbers its refs per document; a snapshot names the document it reads.
    object
        .entry("candidateId")
        .or_insert_with(|| serde_json::Value::from(format!("doc-{}", std::process::id())));
    Ok(Options {
        scenario: None,
        url,
        operation,
        args,
        keep_open,
    })
}
