//! The agent runtime ships inside the app (docs/agents/runtime.md): its nitro build as
//! the `agent-runtime` resource and a Node binary as the `misty-node` sidecar, which the app
//! starts on loopback (`src-tauri/src/infra/agent_runtime`).
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

use super::model::cross_target;

/// Builds the runtime and puts the Node binary where Tauri bundles sidecars from.
/// `MISTY_RELEASE_NODE` names the Node to ship, built for the release's target: a
/// universal (`lipo -create`) binary for macOS, an `.exe` for Windows.
pub(super) fn prepare(workspace: &Workspace, platform: &str) -> Result<()> {
    build(workspace)?;
    let node = std::env::var_os("MISTY_RELEASE_NODE")
        .map(PathBuf::from)
        .context(
        "set MISTY_RELEASE_NODE to the Node binary the app ships, built for this release's target",
    )?;
    if !node.is_file() {
        bail!("MISTY_RELEASE_NODE does not name a file");
    }
    let triple = match cross_target(platform) {
        Some(target) => target.to_owned(),
        None => host_triple()?,
    };
    install_sidecar(workspace, &node, &triple)
}

/// A test build ships the Node that built it, for this computer alone.
pub(super) fn prepare_for_host(workspace: &Workspace) -> Result<()> {
    build(workspace)?;
    let node = CommandSpec::new("node")
        .args(["-p", "process.execPath"])
        .capture(&workspace.misty)?;
    install_sidecar(workspace, node.trim().as_ref(), &host_triple()?)
}

fn build(workspace: &Workspace) -> Result<()> {
    let runtime = workspace.misty.join("src-tauri/services/agent-runtime");
    CommandSpec::new(npm()).args(["ci"]).run(&runtime)?;
    CommandSpec::new(npm())
        .args(["run", "build"])
        .run(&runtime)?;
    if !runtime.join(".output/server/index.mjs").is_file() {
        bail!("the agent runtime build has no .output/server/index.mjs");
    }
    Ok(())
}

fn install_sidecar(workspace: &Workspace, node: &Path, triple: &str) -> Result<()> {
    let windows = triple.contains("windows");
    let binaries = workspace.misty.join("src-tauri/binaries");
    std::fs::create_dir_all(&binaries)?;
    let sidecar = binaries.join(format!(
        "misty-node-{triple}{}",
        if windows { ".exe" } else { "" }
    ));
    std::fs::copy(node, &sidecar).with_context(|| format!("copy {}", node.display()))?;
    Ok(())
}

fn host_triple() -> Result<String> {
    let output = std::process::Command::new("rustc").arg("-vV").output()?;
    String::from_utf8(output.stdout)?
        .lines()
        .find_map(|line| line.strip_prefix("host: ").map(str::to_owned))
        .context("rustc did not report its host")
}

/// The bundle settings that carry the runtime and its Node.
pub(super) fn bundle_settings() -> serde_json::Value {
    serde_json::json!({
        "resources": { "services/agent-runtime/.output": "agent-runtime" },
        "externalBin": ["binaries/misty-node"]
    })
}
