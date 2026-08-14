//! Releases build on this computer, never on GitHub. scripts/release.sh tests
//! the pushed commit, builds and pushes the images, and tags the commit; this
//! module saves the resulting digests where `misty server prod deploy` reads them.

use std::fs;

use anyhow::{bail, Context, Result};

use crate::{
    environment::{self, Target},
    process::CommandSpec,
    workspace::Workspace,
};

pub fn release(workspace: &Workspace, version: &str) -> Result<()> {
    let output = workspace.server.join(".misty/release-output.env");
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let _ = fs::remove_file(&output);
    CommandSpec::new("bash")
        .arg("scripts/release.sh")
        .arg(version)
        .env("MISTY_RELEASE_OUTPUT", &output)
        .run(&workspace.server)?;
    let contents = fs::read_to_string(&output)
        .with_context(|| format!("release produced no image digests at {}", output.display()))?;
    let _ = fs::remove_file(&output);
    let mut saved = 0;
    for line in contents.lines() {
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        if !matches!(name, "MISTY_API_IMAGE" | "MISTY_AGENT_RUNTIME_IMAGE")
            || !value.contains("@sha256:")
        {
            bail!("unexpected release output: {name}");
        }
        environment::set(workspace, Target::Prod, name, value)?;
        println!("  {name}={value}");
        saved += 1;
    }
    if saved != 2 {
        bail!("release did not report both image digests");
    }
    println!("Saved to server/.env/prod/runtime.env. Deploy with: misty server prod deploy");
    Ok(())
}
