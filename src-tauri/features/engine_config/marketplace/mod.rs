//! The engines' own plugin marketplaces, read and changed through each engine's own CLI.
//!
//! Misty keeps no catalog of its own and holds no key. Claude Code and Codex list what their
//! marketplaces offer (`plugin list --json --available`), install and remove with their own
//! commands, and a plugin that brings an app signs in the way that engine does, under the
//! person's own account. Nothing is shared between engines: a Gmail connected in Claude stays
//! Claude's. Adding a marketplace source adds it to that engine, the way its own CLI would.

mod listings;
mod parse;
mod parse_more;
#[cfg(test)]
mod tests;

use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

use super::cli_lifecycle::{command_for_binary, engine_bin, run_capture, ProcOutput};
use listings::{list_gallery, list_loose, list_omp};
use parse::*;
pub use parse::{Connector, MarketItem, MarketSource, ShownCommand};
use parse_more::*;

/// Engines whose CLI lists and installs plugins from marketplaces.
const ENGINES: &[&str] = &[
    "claude",
    "codex",
    "omp",
    "qoder",
    "codebuddy",
    "minimax",
    "gemini",
    "qwen",
];

/// Engines that install from Gemini's public extension gallery.
const GALLERY_ENGINES: &[&str] = &["gemini", "qwen"];

/// The plugin subcommand: Qoder spells it `plugins`, the rest `plugin`.
fn plugin_word(engine: &str) -> &'static str {
    if engine == "qoder" {
        "plugins"
    } else {
        "plugin"
    }
}

const LIST_LIMIT: Duration = Duration::from_secs(60);
/// Installing clones or downloads the plugin.
const CHANGE_LIMIT: Duration = Duration::from_secs(300);
/// `claude mcp list` checks every server's health before it prints.
const CONNECTORS_LIMIT: Duration = Duration::from_secs(90);
/// A plugin manifest is a small JSON file; anything bigger is not one.
const MANIFEST_LIMIT: u64 = 256 << 10;

/// One engine's marketplace: what it offers and has installed, and where it reads plugins from.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineMarket {
    pub engine: String,
    /// The engine's CLI answered. When it didn't, `items` is empty and the page offers no
    /// installs for it.
    pub ready: bool,
    pub items: Vec<MarketItem>,
    pub sources: Vec<MarketSource>,
    /// The engine's own words when listing failed.
    pub error: Option<String>,
}

/// How an install went.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "result")]
pub enum InstallOutcome {
    Installed,
    /// The plugin's marketplace runs a command of its own to fetch it. The person sees it and
    /// confirms, and a second install passes its sha256, which accepts exactly that command.
    ConfirmCommand {
        command: ShownCommand,
    },
}

fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can do this.".into())
    }
}

fn checked_engine(engine: &str) -> Result<&'static str, String> {
    ENGINES
        .iter()
        .copied()
        .find(|known| *known == engine.trim())
        .ok_or_else(|| format!("{engine} has no plugin marketplace Misty can read."))
}

/// The engine's CLI with Misty's PATH and proxy, and Codex's home from Settings.
fn engine_command(engine: &str) -> tokio::process::Command {
    let mut command = command_for_binary(&engine_bin(engine));
    // Codex refuses to start when CODEX_HOME names a folder that doesn't exist; then its own
    // default applies.
    let codex_home = crate::engines::codex_home();
    if engine == "codex" && file_access::fs::exists(&codex_home) {
        command.env("CODEX_HOME", codex_home);
    }
    command
}

async fn run(engine: &str, args: &[&str], limit: Duration) -> Result<ProcOutput, String> {
    let mut command = engine_command(engine);
    command.args(args);
    let output = run_capture(&mut command, limit).await?;
    if output.timed_out {
        return Err(format!("{} didn't answer in time.", engine_label(engine)));
    }
    Ok(output)
}

/// The output of a run that must succeed, or the engine's own last words.
async fn run_ok(engine: &str, args: &[&str], limit: Duration) -> Result<String, String> {
    let output = run(engine, args, limit).await?;
    if output.status.is_some_and(|status| status.success()) {
        Ok(output.stdout)
    } else {
        Err(failure_text(engine, &output))
    }
}

fn engine_label(engine: &str) -> &'static str {
    match engine {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "omp" => "Oh My Pi",
        "qoder" => "Qoder",
        "codebuddy" => "CodeBuddy",
        "minimax" => "MiniMax Code",
        "gemini" => "Gemini CLI",
        "qwen" => "Qwen Code",
        _ => "The engine",
    }
}

/// The engine's own message for a failed run: a JSON result's `error`, else the last line it
/// printed on stderr.
fn failure_text(engine: &str, output: &ProcOutput) -> String {
    let from_json = last_json_line(&output.stdout).and_then(|result| {
        ["error", "message"]
            .iter()
            .find_map(|key| result[key].as_str().map(str::to_string))
    });
    from_json
        .or_else(|| {
            output
                .stderr
                .lines()
                .rev()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| format!("{} couldn't do this.", engine_label(engine)))
}

/// The JSON a `--json` run printed, read from the first line that starts it, so a notice the CLI
/// prints first (an update hint, a first-run line) doesn't hide it.
fn parse_json(engine: &str, stdout: &str) -> Result<Value, String> {
    let mut offset = 0;
    for line in stdout.split_inclusive('\n') {
        if line.trim_start().starts_with(['{', '[']) {
            if let Ok(value) = serde_json::from_str(stdout[offset..].trim()) {
                return Ok(value);
            }
        }
        offset += line.len();
    }
    Err(format!(
        "{} answered in a form Misty can't read.",
        engine_label(engine)
    ))
}

/// A plugin manifest (`plugin.json` in the given folder), when Misty may read it.
fn read_manifest(folder: &Path) -> Option<Value> {
    let path = folder.join("plugin.json");
    let size = file_access::fs::metadata(&path).ok()?.len();
    if size > MANIFEST_LIMIT {
        return None;
    }
    serde_json::from_slice(&file_access::fs::read(&path).ok()?).ok()
}

async fn list_engine(engine: &'static str) -> Result<(Vec<MarketItem>, Vec<MarketSource>), String> {
    match engine {
        "omp" => return list_omp().await,
        "qoder" | "codebuddy" | "minimax" => return list_loose(engine).await,
        "gemini" | "qwen" => return list_gallery(engine).await,
        _ => {}
    }
    // Claude Code and Codex spell these the same way.
    let (plugins, sources) = tokio::join!(
        run_ok(
            engine,
            &["plugin", "list", "--json", "--available"],
            LIST_LIMIT
        ),
        run_ok(
            engine,
            &["plugin", "marketplace", "list", "--json"],
            LIST_LIMIT
        ),
    );
    let plugins = parse_json(engine, &plugins?)?;
    // A source list that fails leaves the plugins readable.
    let sources = sources
        .ok()
        .and_then(|text| parse_json(engine, &text).ok())
        .unwrap_or(Value::Null);
    tokio::task::spawn_blocking(move || match engine {
        "claude" => (
            claude_items(&plugins, &read_manifest),
            claude_sources(&sources),
        ),
        _ => (
            codex_items(&plugins, &read_manifest),
            codex_sources(&sources),
        ),
    })
    .await
    .map_err(|_| "Reading the plugins failed.".to_string())
}

/// What an engine's marketplaces offer and what it has installed. An engine whose CLI isn't
/// installed or signed in answers with `ready: false` and its own message.
#[tauri::command]
pub async fn engine_market_list(
    webview: tauri::Webview,
    engine: String,
) -> Result<EngineMarket, String> {
    person_window(&webview)?;
    let engine = checked_engine(&engine)?;
    Ok(match list_engine(engine).await {
        Ok((items, sources)) => EngineMarket {
            engine: engine.into(),
            ready: true,
            items,
            sources,
            error: None,
        },
        Err(error) => EngineMarket {
            engine: engine.into(),
            ready: false,
            items: Vec::new(),
            sources: Vec::new(),
            error: Some(error),
        },
    })
}

/// Installs a plugin with the engine's own command. A Claude plugin fetched by a command of its
/// marketplace's comes back as `ConfirmCommand` the first time; installing again with that
/// command's sha256 accepts exactly that command and nothing else.
#[tauri::command]
pub async fn engine_market_install(
    webview: tauri::Webview,
    engine: String,
    id: String,
    accept: Option<String>,
) -> Result<InstallOutcome, String> {
    person_window(&webview)?;
    let engine = checked_engine(&engine)?;
    // Gallery extensions install from their GitHub address; the rest by `name@marketplace`.
    let valid = if GALLERY_ENGINES.contains(&engine) {
        valid_gallery_url(&id)
    } else {
        valid_id(&id)
    };
    if !valid {
        return Err("That isn't a plugin Misty can install.".into());
    }
    match engine {
        "claude" => {
            let mut args = vec!["plugin", "install", "--json"];
            let accept =
                accept.filter(|sha| sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()));
            if let Some(sha) = accept.as_deref() {
                args.extend(["--accept-command", sha]);
            }
            args.extend(["--", &id]);
            let output = run(engine, &args, CHANGE_LIMIT).await?;
            if let Some(command) = last_json_line(&output.stdout)
                .as_ref()
                .and_then(shown_command)
                .filter(|_| accept.is_none())
            {
                return Ok(InstallOutcome::ConfirmCommand { command });
            }
            if output.status.is_some_and(|status| status.success()) {
                Ok(InstallOutcome::Installed)
            } else {
                Err(failure_text(engine, &output))
            }
        }
        // These take no `--` (or weren't checked to); the checks above keep the id from reading
        // as an option.
        "omp" | "qoder" | "codebuddy" | "minimax" | "gemini" | "qwen" => {
            let word = plugin_word(engine);
            let args: &[&str] = match engine {
                "minimax" => &[word, "add", &id],
                // Gemini asks before installing; the person chose Install, which is the consent.
                "gemini" => &["extensions", "install", &id, "--consent"],
                "qwen" => &["extensions", "install", &id],
                _ => &[word, "install", &id],
            };
            run_ok(engine, args, CHANGE_LIMIT).await?;
            Ok(InstallOutcome::Installed)
        }
        _ => {
            run_ok(
                engine,
                &["plugin", "add", "--json", "--", &id],
                CHANGE_LIMIT,
            )
            .await?;
            Ok(InstallOutcome::Installed)
        }
    }
}

/// Removes a plugin with the engine's own command.
#[tauri::command]
pub async fn engine_market_remove(
    webview: tauri::Webview,
    engine: String,
    id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let engine = checked_engine(&engine)?;
    // An installed gallery extension goes by its name; a plugin by `name@marketplace`.
    let valid = if GALLERY_ENGINES.contains(&engine) {
        valid_name(&id)
    } else {
        valid_id(&id)
    };
    if !valid {
        return Err("That isn't a plugin Misty can remove.".into());
    }
    let word = plugin_word(engine);
    let args: &[&str] = match engine {
        "claude" => &["plugin", "uninstall", "--json", "--", &id],
        "omp" | "qoder" | "codebuddy" => &[word, "uninstall", &id],
        "minimax" => &[word, "remove", &id],
        "gemini" | "qwen" => &["extensions", "uninstall", &id],
        _ => &["plugin", "remove", "--", &id],
    };
    run_ok(engine, args, CHANGE_LIMIT).await.map(drop)
}

/// Adds a marketplace to the engine: a GitHub `owner/repo`, a git URL or a folder.
#[tauri::command]
pub async fn engine_market_add_source(
    webview: tauri::Webview,
    engine: String,
    source: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let engine = checked_engine(&engine)?;
    let source = source.trim().to_string();
    if !valid_source(&source) {
        return Err("Use a GitHub owner/repo, an https:// address or a folder.".into());
    }
    let word = plugin_word(engine);
    let args: &[&str] = match engine {
        "claude" => &["plugin", "marketplace", "add", "--json", "--", &source],
        "omp" | "qoder" | "codebuddy" => &[word, "marketplace", "add", &source],
        "codex" => &["plugin", "marketplace", "add", "--", &source],
        _ => return Err(no_sources(engine)),
    };
    run_ok(engine, args, CHANGE_LIMIT).await.map(drop)
}

/// Removes a marketplace from the engine by name.
#[tauri::command]
pub async fn engine_market_remove_source(
    webview: tauri::Webview,
    engine: String,
    name: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let engine = checked_engine(&engine)?;
    if !valid_name(&name) {
        return Err("That isn't a marketplace Misty can remove.".into());
    }
    let word = plugin_word(engine);
    let args: &[&str] = match engine {
        "claude" => &["plugin", "marketplace", "remove", "--json", "--", &name],
        "omp" | "qoder" | "codebuddy" => &[word, "marketplace", "remove", &name],
        "codex" => &["plugin", "marketplace", "remove", "--", &name],
        _ => return Err(no_sources(engine)),
    };
    run_ok(engine, args, CHANGE_LIMIT).await.map(drop)
}

/// MiniMax adds marketplaces only in its own app, and Gemini and Qwen read the one gallery.
fn no_sources(engine: &str) -> String {
    format!(
        "{} doesn't take marketplaces from Misty.",
        engine_label(engine)
    )
}

/// The apps Claude Code reaches under the person's own sign-in: claude.ai connectors and the
/// servers its plugins bring, each with its state. Addresses stay out (a URL can carry a token).
/// Codex's apps come with its plugins and sign in when installed or first used, so they show in
/// its marketplace instead.
#[tauri::command]
pub async fn engine_market_connectors(webview: tauri::Webview) -> Result<Vec<Connector>, String> {
    person_window(&webview)?;
    let output = run_ok("claude", &["mcp", "list"], CONNECTORS_LIMIT).await?;
    Ok(claude_connectors(&output)
        .into_iter()
        .filter(|connector| connector.origin != "config")
        .collect())
}
