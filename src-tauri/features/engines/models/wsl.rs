// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/wsl.rs.
//! Engine model catalogs inside a WSL distro: each CLI's model command runs remotely through
//! wsl_transport (bin = the absolute in-distro path the probe wrote into the workspace meta),
//! parsed by the same parsers as on this computer. Every remote catalog carries the remote
//! flag: even when empty, the frontend must not mix in local config.

use super::{pi, EngineCatalog, EngineModel};

use crate::engines::wsl_transport::WslTransport;

pub(super) async fn pi_family_catalog_remote(
    engine: &str,
    transport: &WslTransport,
) -> EngineCatalog {
    let (Some(bin), Some(cwd)) = (bin_for(transport, engine), remote_cwd(transport)) else {
        return EngineCatalog::authoritative_remote(Vec::new());
    };
    let script = format!("cd {cwd} 2>/dev/null; {bin} models --json");
    match crate::engines::wsl_transport::run_script_output(transport, &script).await {
        Ok(stdout) => match pi::parse_models_json(&stdout) {
            Ok(models) if !models.is_empty() => EngineCatalog::authoritative_remote(models),
            _ => EngineCatalog::authoritative_remote(Vec::new()),
        },
        Err(_) => EngineCatalog::authoritative_remote(Vec::new()),
    }
}

/// Remote Codex catalog: `<bin> debug models` (the same command as the local codex_catalog),
/// falling back to the single model= in the distro's `$CODEX_HOME/config.toml` when it fails
/// or is empty.
pub(super) async fn codex_catalog_remote(transport: &WslTransport) -> EngineCatalog {
    let (Some(bin), Some(cwd)) = (bin_for(transport, "codex"), remote_cwd(transport)) else {
        return EngineCatalog::authoritative_remote(Vec::new());
    };
    let script = format!("cd {cwd} 2>/dev/null; {bin} debug models 2>/dev/null");
    if let Ok(stdout) = crate::engines::wsl_transport::run_script_output(transport, &script).await {
        if let Ok(models) = super::codex::parse_codex_models_json(&stdout) {
            if !models.is_empty() {
                return EngineCatalog::authoritative_remote(super::with_default_first(
                    models,
                    codex_config_model_remote(transport).await,
                ));
            }
        }
    }
    EngineCatalog::authoritative_remote(
        codex_config_model_remote(transport)
            .await
            .into_iter()
            .collect(),
    )
}

/// Remote Kimi catalog: `<bin> provider list --json` (the same command as locally).
pub(super) async fn kimi_catalog_remote(transport: &WslTransport) -> EngineCatalog {
    let (Some(bin), Some(cwd)) = (bin_for(transport, "kimi"), remote_cwd(transport)) else {
        return EngineCatalog::authoritative_remote(Vec::new());
    };
    let script = format!("cd {cwd} 2>/dev/null; {bin} provider list --json 2>/dev/null");
    let default = kimi_config_model_remote(transport).await;
    if let Ok(stdout) = crate::engines::wsl_transport::run_script_output(transport, &script).await {
        let models = super::kimi::parse_kimi_provider_list(&stdout);
        if !models.is_empty() {
            // Same as the local kimi_catalog: the configured default goes first (a reset pick
            // takes the first entry as the CLI's real default; alphabetical order would reset
            // to an arbitrary entry).
            return EngineCatalog::authoritative_remote(super::with_default_first(models, default));
        }
    }
    EngineCatalog::authoritative_remote(default.into_iter().collect())
}

/// The top-level `default_model = "…"` in the distro's `$KIMI_CODE_HOME/config.toml` (default
/// ~/.kimi-code): the one runnable entry when provider list fails.
async fn kimi_config_model_remote(transport: &WslTransport) -> Option<EngineModel> {
    let script = r#"cat "${KIMI_CODE_HOME:-$HOME/.kimi-code}/config.toml" 2>/dev/null"#;
    let content = crate::engines::wsl_transport::run_script_output(transport, script)
        .await
        .ok()?;
    let model = super::parse_top_level_toml_string(&content, "default_model")?;
    Some(EngineModel {
        id: model,
        name: None,
        description: None,
        provider: "kimi".to_string(),
        context_window: None,
    })
}

/// Remote Claude catalog: the CLI aliases are built-in constants, merged field by field with
/// the distro's `$CLAUDE_CONFIG_DIR` settings.json / settings.local.json (the same merge as the
/// local read_cli_config_from), reproducing the distro's own /model menu.
pub(super) async fn claude_catalog_remote(transport: &WslTransport) -> EngineCatalog {
    // A random separator: a fixed string could appear inside the settings (an env value), and
    // split_once on its first occurrence would merge the rest of the user settings as local,
    // getting the precedence wrong.
    let sep = format!("=CCGUI_SEP_{}=", uuid::Uuid::new_v4().simple());
    let script = format!(
        r#"d="${{CLAUDE_CONFIG_DIR:-$HOME/.claude}}"; cat "$d/settings.json" 2>/dev/null; echo "{sep}"; cat "$d/settings.local.json" 2>/dev/null"#
    );
    let out = crate::engines::wsl_transport::run_script_output(transport, &script)
        .await
        .unwrap_or_default();
    let (user, local) = match out.split_once(&sep) {
        Some((u, l)) => (u, l),
        None => (out.as_str(), ""),
    };
    EngineCatalog::authoritative_remote(super::claude::claude_models_remote(user, local))
}
fn bin_for(transport: &WslTransport, engine: &str) -> Option<String> {
    transport
        .engine_paths
        .get(engine)
        .map(|b| shell_safe_bin(b))
        .filter(|b| !b.is_empty())
}

/// The top-level model= in the distro's `$CODEX_HOME/config.toml` (default ~/.codex).
async fn codex_config_model_remote(transport: &WslTransport) -> Option<EngineModel> {
    let script = r#"cat "${CODEX_HOME:-$HOME/.codex}/config.toml" 2>/dev/null"#;
    let content = crate::engines::wsl_transport::run_script_output(transport, script)
        .await
        .ok()?;
    let model = super::parse_top_level_toml_string(&content, "model")?;
    Some(EngineModel {
        id: model,
        name: None,
        description: None,
        provider: "codex".to_string(),
        context_window: None,
    })
}

/// The `cd` target inside the distro. The workspace character allowlist is the same rule as the
/// send path's build_script (is_safe_workspace); a violation returns None and the caller gives
/// an empty catalog, never a script with that path (the catalog path once skipped the
/// allowlist, an injection surface).
fn remote_cwd(transport: &WslTransport) -> Option<String> {
    match &transport.workspace {
        Some(ws) => crate::engines::wsl_transport::is_safe_workspace(ws).then(|| ws.clone()),
        None => Some("~".to_string()),
    }
}

/// The probed path comes from `command -v` output (an absolute in-distro path) and is checked
/// once more against an allowlist: only `[A-Za-z0-9_./~-]`. A violation returns an empty string
/// so the command fails instead of injecting.
fn shell_safe_bin(bin: &str) -> String {
    if bin.is_empty()
        || bin
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | '-' | '~')))
    {
        return String::new();
    }
    bin.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bin_allowlist_rejects_injection() {
        assert_eq!(
            shell_safe_bin("/home/u/.local/bin/omp"),
            "/home/u/.local/bin/omp"
        );
        assert_eq!(shell_safe_bin("/x; rm -rf /"), "");
        assert_eq!(shell_safe_bin("/a b/c"), "");
        assert_eq!(shell_safe_bin(""), "");
    }

    fn tp(workspace: Option<&str>) -> WslTransport {
        WslTransport {
            host: "10.0.0.2".into(),
            port: 22,
            user: "dev".into(),
            distro: "Ubuntu".into(),
            control_path: None,
            engine_paths: Default::default(),
            workspace: workspace.map(str::to_string),
        }
    }

    #[test]
    fn remote_cwd_rejects_injection_shaped_workspace() {
        // The catalog script inlines `cd <cwd>`, so a violating workspace must get no cwd (an
        // empty catalog) rather than be spliced into the script (the catalog path once drifted
        // from the build_script allowlist, an injection surface).
        assert_eq!(
            remote_cwd(&tp(Some("/home/dev/proj"))).as_deref(),
            Some("/home/dev/proj")
        );
        assert_eq!(remote_cwd(&tp(None)).as_deref(), Some("~"));
        assert!(remote_cwd(&tp(Some("/home/dev/my proj"))).is_none());
        assert!(remote_cwd(&tp(Some("/x;id"))).is_none());
        assert!(remote_cwd(&tp(Some("/x$(id)"))).is_none());
    }
}
