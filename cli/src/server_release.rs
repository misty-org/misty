//! Releases build on this computer, never on GitHub. This module tests the pushed
//! commit, builds and pushes the server images, tags the commit, and saves the
//! image digests where `misty server prod deploy` reads them.

use std::{fs, path::Path};

use anyhow::{bail, Context, Result};
use regex::Regex;

use crate::{
    environment::{self, Target},
    process::CommandSpec,
    workspace::Workspace,
};

const REGISTRY: &str = "ghcr.io/misty-org";

struct Image {
    name: &'static str,
    dockerfile: &'static str,
    target: Option<&'static str>,
    setting: &'static str,
}

const IMAGES: [Image; 2] = [
    Image {
        name: "misty-api",
        dockerfile: "server/Dockerfile",
        target: None,
        setting: "MISTY_API_IMAGE",
    },
    Image {
        name: "misty-agent-runtime",
        dockerfile: "server/apps/agent-runtime/Dockerfile",
        target: Some("runtime"),
        setting: "MISTY_AGENT_RUNTIME_IMAGE",
    },
];

pub fn release(workspace: &Workspace, version: &str) -> Result<()> {
    validate_version(version)?;
    let root = &workspace.misty;
    let tag = format!("server-v{version}");
    require_pushed_commit(root, &tag)?;
    CommandSpec::new("docker")
        .args(["buildx", "version"])
        .capture(root)
        .context("Docker with buildx is required to build release images")?;

    let sha = git(root, &["rev-parse", "HEAD"])?;
    println!("Running the server suites on {}", &sha[..7]);
    for suite in ["secrets", "server"] {
        CommandSpec::new("bash")
            .args([".githooks/checks.sh", suite])
            .run(root)?;
    }

    let metadata = tempfile::tempdir()?;
    let mut references = Vec::new();
    for image in &IMAGES {
        references.push((
            image.setting,
            build(root, image, version, &sha, metadata.path())?,
        ));
    }

    let message = format!("Misty server {version}");
    git(root, &["tag", "-a", &tag, "-m", &message, &sha])?;
    // The commit was already checked above, so the push skips the hooks.
    git(root, &["push", "--quiet", "--no-verify", "origin", &tag])?;
    println!("Released {tag}.");

    for (name, value) in references {
        environment::set(workspace, Target::Prod, name, &value)?;
        println!("  {name}={value}");
    }
    println!("Saved to server/.env/prod/runtime.env. Deploy with: misty server prod deploy");
    Ok(())
}

fn validate_version(version: &str) -> Result<()> {
    let pattern = Regex::new(r"^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$")?;
    if !pattern.is_match(version) {
        bail!("Versions look like 0.1.0.");
    }
    Ok(())
}

/// Every release is a commit on GitHub: clean tree, pushed HEAD, unused tag.
fn require_pushed_commit(root: &Path, tag: &str) -> Result<()> {
    if !git(root, &["status", "--porcelain", "--untracked-files=no"])?.is_empty() {
        bail!("Commit or discard local changes first.");
    }
    git(root, &["fetch", "--quiet", "origin"])?;
    if git(root, &["rev-parse", "HEAD"])? != git(root, &["rev-parse", "@{upstream}"])? {
        bail!("Push this commit first, so every release is a commit on GitHub.");
    }
    if !git(root, &["tag", "--list", tag])?.is_empty() {
        bail!("{tag} already exists.");
    }
    Ok(())
}

/// Builds and pushes one image for linux/amd64 and returns `image@digest`.
fn build(root: &Path, image: &Image, version: &str, sha: &str, metadata: &Path) -> Result<String> {
    let repository = format!("{REGISTRY}/{}", image.name);
    let metadata_file = metadata.join(format!("{}.json", image.name));
    println!("Building {repository}:{version} for linux/amd64");
    let mut command = CommandSpec::new("docker").args([
        "buildx",
        "build",
        "--platform",
        "linux/amd64",
        "--provenance=false",
        "--push",
        "--file",
        image.dockerfile,
    ]);
    if let Some(target) = image.target {
        command = command.args(["--target", target]);
    }
    command
        .args(["--tag", &format!("{repository}:{version}")])
        .args(["--tag", &format!("{repository}:sha-{sha}")])
        .arg("--metadata-file")
        .arg(&metadata_file)
        .arg("server")
        .run(root)?;
    let digest = image_digest(&fs::read_to_string(&metadata_file)?)?;
    Ok(format!("{repository}@{digest}"))
}

fn image_digest(metadata: &str) -> Result<String> {
    let parsed: serde_json::Value = serde_json::from_str(metadata)?;
    let digest = parsed["containerimage.digest"]
        .as_str()
        .context("build metadata has no image digest")?;
    if !digest.starts_with("sha256:") {
        bail!("unexpected image digest: {digest}");
    }
    Ok(digest.to_string())
}

fn git(root: &Path, arguments: &[&str]) -> Result<String> {
    Ok(CommandSpec::new("git")
        .args(arguments)
        .capture(root)?
        .trim()
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_must_be_semantic() {
        assert!(validate_version("0.1.0").is_ok());
        assert!(validate_version("1.2.3-beta.1").is_ok());
        assert!(validate_version("v0.1.0").is_err());
        assert!(validate_version("0.1").is_err());
    }

    #[test]
    fn digest_comes_from_build_metadata() {
        let digest = image_digest(r#"{"containerimage.digest":"sha256:abc"}"#).unwrap();
        assert_eq!(digest, "sha256:abc");
        assert!(image_digest(r#"{"containerimage.digest":"abc"}"#).is_err());
        assert!(image_digest("{}").is_err());
    }
}
