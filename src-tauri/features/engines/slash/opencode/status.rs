//! `/status` and `/debug`: what the server has loaded and where it runs.

use super::*;

/// What OpenCode's terminal app shows under `/status`: its MCP servers, LSP servers, formatters
/// and plugins. A part that won't load says why in its own section.
pub(super) async fn status(server: &Server) -> Result<Output, String> {
    let (mcp, lsp, formatter, config) = tokio::join!(
        server.get("/mcp"),
        server.get("/lsp"),
        server.get("/formatter"),
        server.get("/config"),
    );
    let mut sections = vec![section_of("MCP servers", mcp, |mcp| {
        mcp.as_object()
            .into_iter()
            .flatten()
            .map(|(name, status)| row(name, mcp_state(name, status)))
            .collect()
    })];
    let lsp = section_of("LSP servers", lsp, |lsp| {
        lsp.as_array()
            .into_iter()
            .flatten()
            .map(|lsp| {
                let root = text_at(lsp, "/root").unwrap_or_default();
                let value = if text_at(lsp, "/status") == Some("error") {
                    format!("{root} (error)")
                } else {
                    root.to_owned()
                };
                row(text_at(lsp, "/id").unwrap_or_default(), value)
            })
            .collect()
    });
    // OpenCode lists LSP servers only once one has started.
    if !lsp.rows.is_empty() || lsp.text.as_deref() != Some(NONE) {
        sections.push(lsp);
    }
    sections.push(section_of("Formatters", formatter, |formatter| {
        formatter
            .as_array()
            .into_iter()
            .flatten()
            .filter(|f| f.get("enabled").and_then(Value::as_bool) == Some(true))
            .map(|f| {
                let extensions = f
                    .get("extensions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" ");
                row(text_at(f, "/name").unwrap_or_default(), extensions)
            })
            .collect()
    }));
    sections.push(section_of("Plugins", config, |config| {
        let mut plugins: Vec<(String, String)> = config
            .get("plugin")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| match item {
                Value::String(spec) => Some(plugin_name(spec)),
                Value::Array(pair) => pair.first().and_then(Value::as_str).map(plugin_name),
                _ => None,
            })
            .collect();
        plugins.sort();
        plugins
            .into_iter()
            .map(|(name, version)| row(name, version))
            .collect()
    }));
    Ok(Output::info("Status", sections))
}

const NONE: &str = "None";

/// One status section: its rows from a loaded answer, "None" when it has none, or the error.
fn section_of(
    heading: &str,
    answer: Result<Value, String>,
    rows: impl FnOnce(&Value) -> Vec<Row>,
) -> Section {
    let (rows, text) = match answer {
        Ok(value) => {
            let rows = rows(&value);
            let text = rows.is_empty().then(|| NONE.to_string());
            (rows, text)
        }
        Err(error) => (Vec::new(), Some(error)),
    };
    Section {
        heading: Some(heading.to_owned()),
        rows,
        text,
    }
}

/// An MCP server's state, in the words OpenCode's own status uses.
pub(super) fn mcp_state(name: &str, status: &Value) -> String {
    match text_at(status, "/status").unwrap_or_default() {
        "connected" => "Connected".into(),
        "disabled" => "Off".into(),
        "needs_auth" => format!("Needs sign-in: /mcps auth {name}"),
        "failed" | "needs_client_registration" => {
            text_at(status, "/error").unwrap_or("Failed").to_owned()
        }
        other => other.to_owned(),
    }
}

/// A plugin's name and version from its spec, as OpenCode's status shows them: `name@1.2` from
/// npm, the file's (or its folder's, for an `index`) name from a `file://` path.
fn plugin_name(spec: &str) -> (String, String) {
    if let Some(path) = spec.strip_prefix("file://") {
        let mut parts = path.rsplit('/').filter(|part| !part.is_empty());
        let file = parts.next().unwrap_or(path);
        let Some((base, _)) = file.split_once('.') else {
            return (file.to_owned(), String::new());
        };
        let name = if base == "index" {
            parts.next().unwrap_or(base)
        } else {
            base
        };
        return (name.to_owned(), String::new());
    }
    match spec.rfind('@') {
        Some(at) if at > 0 => (spec[..at].to_owned(), spec[at + 1..].to_owned()),
        _ => (spec.to_owned(), "latest".to_owned()),
    }
}

/// What OpenCode's terminal app shows under `/debug`, plus the server's paths and branch.
pub(super) async fn debug(server: &Server, session: Option<&str>) -> Result<Output, String> {
    let (health, paths, vcs, config) = tokio::join!(
        server.get("/global/health"),
        server.get("/path"),
        server.get("/vcs"),
        server.get("/config"),
    );
    let (health, paths, vcs, config) = (
        health.unwrap_or(Value::Null),
        paths.unwrap_or(Value::Null),
        vcs.unwrap_or(Value::Null),
        config.unwrap_or(Value::Null),
    );
    let or_none = |value: Option<&str>| value.unwrap_or("n/a").to_owned();
    let rows = vec![
        row("Version", or_none(text_at(&health, "/version"))),
        row(
            "OS",
            format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        ),
        row("Session", or_none(session)),
        row("Model", or_none(text_at(&config, "/model"))),
        row("Folder", or_none(text_at(&paths, "/directory"))),
        row("Worktree", or_none(text_at(&paths, "/worktree"))),
        row("Branch", or_none(text_at(&vcs, "/branch"))),
        row("Config", or_none(text_at(&paths, "/config"))),
        row("State", or_none(text_at(&paths, "/state"))),
        row("Server", server.origin.clone()),
    ];
    Ok(Output::info(
        "Debug",
        vec![Section {
            rows,
            ..Default::default()
        }],
    ))
}

/// 2.x's status: its MCP servers (`GET /api/mcp`, a list) and the plugins it loaded beyond its
/// own built-in ones (`GET /api/plugin`). 2.x serves no LSP or formatter status.
pub(super) async fn status_v2(server: &Server) -> Result<Output, String> {
    let (mcp, plugins) = tokio::join!(server.get("/api/mcp"), server.get("/api/plugin"));
    let mcp = section_of("MCP servers", mcp, |mcp| {
        data(mcp)
            .as_array()
            .into_iter()
            .flatten()
            .map(|server| {
                let name = text_at(server, "/name").unwrap_or_default();
                let status = server.get("status").cloned().unwrap_or(Value::Null);
                row(name, mcp_state(name, &status))
            })
            .collect()
    });
    let plugins = section_of("Plugins", plugins, |plugins| {
        data(plugins)
            .as_array()
            .into_iter()
            .flatten()
            .filter(|plugin| text_at(plugin, "/source/type") != Some("builtin"))
            .map(|plugin| {
                let name = text_at(plugin, "/id")
                    .or_else(|| text_at(plugin, "/source/target"))
                    .or_else(|| text_at(plugin, "/source/path"))
                    .unwrap_or_default();
                let version = text_at(plugin, "/source/version").unwrap_or_default();
                let value = match text_at(plugin, "/state/error") {
                    Some(error) => format!("Failed: {error}"),
                    None => version.to_owned(),
                };
                row(name, value)
            })
            .collect()
    });
    Ok(Output::info("Status", vec![mcp, plugins]))
}

/// 2.x's debug facts: version (`/api/info`), folder and project (`/api/location`), branch
/// (`/api/vcs`), default model (`/api/model/default`) and the config files it read (`/api/config`).
pub(super) async fn debug_v2(server: &Server, session: Option<&str>) -> Result<Output, String> {
    let (info, location, vcs, model, config) = tokio::join!(
        server.get("/api/info"),
        server.get("/api/location"),
        server.get("/api/vcs"),
        server.get("/api/model/default"),
        server.get("/api/config"),
    );
    let [info, location, vcs, model, config] =
        [info, location, vcs, model, config].map(|answer| answer.unwrap_or(Value::Null));
    let or_none = |value: Option<&str>| value.unwrap_or("n/a").to_owned();
    let model = data(&model);
    let model = text_at(model, "/providerID")
        .zip(text_at(model, "/id"))
        .map(|(provider, id)| format!("{provider}/{id}"));
    let configs = config
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| text_at(entry, "/path"))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = vec![
        row("Version", or_none(text_at(&info, "/version"))),
        row(
            "OS",
            format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        ),
        row("Session", or_none(session)),
        row("Model", or_none(model.as_deref())),
        row("Folder", or_none(text_at(&location, "/directory"))),
        row("Project", or_none(text_at(&location, "/project/canonical"))),
        row("Branch", or_none(text_at(data(&vcs), "/branch/current"))),
        row(
            "Config",
            if configs.is_empty() {
                "n/a".to_owned()
            } else {
                configs
            },
        ),
        row("Temp", or_none(text_at(&info, "/paths/tmp"))),
        row("Server", server.origin.clone()),
    ];
    Ok(Output::info(
        "Debug",
        vec![Section {
            rows,
            ..Default::default()
        }],
    ))
}
