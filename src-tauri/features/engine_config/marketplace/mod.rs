pub mod details;
mod listings;
mod parse;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_live;

use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

use super::cli_lifecycle::{command_for_binary, engine_bin, run_capture_capped, ProcOutput};
use parse::*;
pub use parse::{Connector, MarketItem, MarketSource, ShownCommand};

const ENGINES: &[&str] = &["claude", "codex"];

const LIST_LIMIT: Duration = Duration::from_secs(60);
const CHANGE_LIMIT: Duration = Duration::from_secs(300);
const CONNECTORS_LIMIT: Duration = Duration::from_secs(90);
const MANIFEST_LIMIT: u64 = 256 << 10;
const OUTPUT_LIMIT: usize = 64 << 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineMarket {
    pub engine: String,
    pub ready: bool,
    pub items: Vec<MarketItem>,
    pub sources: Vec<MarketSource>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "result")]
pub enum InstallOutcome {
    Installed,
    ConfirmCommand { command: ShownCommand },
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

fn engine_command(engine: &str) -> tokio::process::Command {
    let mut command = command_for_binary(&engine_bin(engine));
    let codex_home = crate::engines::codex_home();
    if engine == "codex" && file_access::fs::exists(&codex_home) {
        command.env("CODEX_HOME", codex_home);
    }
    command
}

async fn run(engine: &str, args: &[&str], limit: Duration) -> Result<ProcOutput, String> {
    let mut command = engine_command(engine);
    command.args(args);
    let output = run_capture_capped(&mut command, limit, OUTPUT_LIMIT).await?;
    if output.timed_out {
        return Err(format!("{} didn't answer in time.", engine_label(engine)));
    }
    if output.stdout.len() > OUTPUT_LIMIT {
        return Err(format!(
            "{} listed more than Misty can read.",
            engine_label(engine)
        ));
    }
    Ok(output)
}

pub(crate) async fn run_ok(engine: &str, args: &[&str], limit: Duration) -> Result<String, String> {
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
        _ => "The engine",
    }
}

fn failure_text(engine: &str, output: &ProcOutput) -> String {
    let said = format!("{}\n{}", output.stdout, output.stderr);
    if said
        .lines()
        .any(|line| line.trim().ends_with("AUTH_REQUIRED"))
    {
        return format!("Sign in to {} first.", engine_label(engine));
    }
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

fn read_manifest(folder: &Path) -> Option<Value> {
    let path = folder.join("plugin.json");
    let size = file_access::fs::metadata(&path).ok()?.len();
    if size > MANIFEST_LIMIT {
        return None;
    }
    serde_json::from_slice(&file_access::fs::read(&path).ok()?).ok()
}

async fn list_engine(engine: &'static str) -> Result<(Vec<MarketItem>, Vec<MarketSource>), String> {
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
    let sources = sources
        .ok()
        .and_then(|text| parse_json(engine, &text).ok())
        .unwrap_or(Value::Null);
    tokio::task::spawn_blocking(move || match engine {
        "claude" => {
            let mut items = claude_items(&plugins, &read_manifest);
            listings::claude_catalog_details(&mut items);
            (items, claude_sources(&sources))
        }
        _ => (
            codex_items(
                &plugins,
                &read_manifest,
                &crate::engine_config::support::codex_home()
                    .join("plugins")
                    .join("cache"),
            ),
            codex_sources(&sources),
        ),
    })
    .await
    .map_err(|_| "Reading the plugins failed.".to_string())
}

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

#[tauri::command]
pub async fn engine_market_install(
    webview: tauri::Webview,
    engine: String,
    id: String,
    accept: Option<String>,
) -> Result<InstallOutcome, String> {
    person_window(&webview)?;
    install(checked_engine(&engine)?, &id, accept).await
}

async fn install(
    engine: &'static str,
    id: &str,
    accept: Option<String>,
) -> Result<InstallOutcome, String> {
    let id = id.to_string();
    if !valid_id(&id) {
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

#[tauri::command]
pub async fn engine_market_remove(
    webview: tauri::Webview,
    engine: String,
    id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    remove(checked_engine(&engine)?, &id).await
}

async fn remove(engine: &'static str, id: &str) -> Result<(), String> {
    let id = id.to_string();
    if !valid_id(&id) {
        return Err("That isn't a plugin Misty can remove.".into());
    }
    let args: &[&str] = match engine {
        "claude" => &["plugin", "uninstall", "--json", "--", &id],
        _ => &["plugin", "remove", "--", &id],
    };
    run_ok(engine, args, CHANGE_LIMIT).await.map(drop)
}

#[tauri::command]
pub async fn engine_market_add_source(
    webview: tauri::Webview,
    engine: String,
    source: String,
) -> Result<(), String> {
    person_window(&webview)?;
    add_source(checked_engine(&engine)?, &source).await
}

async fn add_source(engine: &'static str, source: &str) -> Result<(), String> {
    let source = source.trim().to_string();
    if !valid_source(&source) {
        return Err("Use a GitHub owner/repo, an https:// address or a folder.".into());
    }
    let args: &[&str] = match engine {
        "claude" => &["plugin", "marketplace", "add", "--json", "--", &source],
        "codex" => &["plugin", "marketplace", "add", "--", &source],
        _ => return Err(no_sources(engine)),
    };
    run_ok(engine, args, CHANGE_LIMIT).await.map(drop)
}

#[tauri::command]
pub async fn engine_market_remove_source(
    webview: tauri::Webview,
    engine: String,
    name: String,
) -> Result<(), String> {
    person_window(&webview)?;
    remove_source(checked_engine(&engine)?, &name).await
}

async fn remove_source(engine: &'static str, name: &str) -> Result<(), String> {
    let name = name.to_string();
    if !valid_name(&name) {
        return Err("That isn't a marketplace Misty can remove.".into());
    }
    let args: &[&str] = match engine {
        "claude" => &["plugin", "marketplace", "remove", "--json", "--", &name],
        "codex" => &["plugin", "marketplace", "remove", "--", &name],
        _ => return Err(no_sources(engine)),
    };
    run_ok(engine, args, CHANGE_LIMIT).await.map(drop)
}

fn no_sources(engine: &str) -> String {
    format!(
        "{} doesn't take marketplaces from Misty.",
        engine_label(engine)
    )
}

#[tauri::command]
pub async fn engine_market_connectors(webview: tauri::Webview) -> Result<Vec<Connector>, String> {
    person_window(&webview)?;
    let output = run_ok("claude", &["mcp", "list"], CONNECTORS_LIMIT).await?;
    Ok(claude_connectors(&output)
        .into_iter()
        .filter(|connector| connector.origin != "config")
        .collect())
}
