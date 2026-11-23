use std::path::{Path, PathBuf};

use super::downloads::{self, Checksum};
use super::ProgressReporter;
use crate::engines::support::paths::{node_runtime_bin_dir, node_runtime_dir};

pub(super) const NODE_VERSION: &str = "24.22.3";
const NODE_DIST: &str = "https://nodejs.org/dist";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NodeArchive {
    pub(super) folder: String,
    pub(super) file: String,
}

pub(super) fn node_archive(os: &str, arch: &str) -> Option<NodeArchive> {
    let os = match os {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "win",
        _ => return None,
    };
    let arch = match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        _ => return None,
    };
    let folder = format!("node-v{NODE_VERSION}-{os}-{arch}");
    let ending = if os == "win" { "zip" } else { "tar.gz" };
    Some(NodeArchive {
        file: format!("{folder}.{ending}"),
        folder,
    })
}

pub(super) fn archive_url(archive: &NodeArchive) -> String {
    format!("{NODE_DIST}/v{NODE_VERSION}/{}", archive.file)
}

fn shasums_url() -> String {
    format!("{NODE_DIST}/v{NODE_VERSION}/SHASUMS256.txt")
}

fn node_in(bin_dir: &Path) -> PathBuf {
    bin_dir.join(if cfg!(windows) { "node.exe" } else { "node" })
}

fn npm_cli_in(root: &Path) -> PathBuf {
    let modules = if cfg!(windows) {
        root.join("node_modules")
    } else {
        root.join("lib").join("node_modules")
    };
    modules.join("npm").join("bin").join("npm-cli.js")
}

pub(super) fn installed() -> bool {
    file_access::fs::is_file(node_in(&node_runtime_bin_dir()))
        && file_access::fs::is_file(npm_cli_in(&node_runtime_dir()))
}

pub(super) fn npm_argv() -> (String, Vec<String>) {
    (
        node_in(&node_runtime_bin_dir())
            .to_string_lossy()
            .into_owned(),
        vec![npm_cli_in(&node_runtime_dir())
            .to_string_lossy()
            .into_owned()],
    )
}

pub(super) fn plan_step() -> String {
    match node_archive(std::env::consts::OS, std::env::consts::ARCH) {
        Some(archive) => format!(
            "Download Node.js {NODE_VERSION} ({}) from nodejs.org, check it against \
             SHASUMS256.txt, and unpack it into {}",
            archive.file,
            super::shown_path(&node_runtime_dir())
        ),
        None => format!("Node.js {NODE_VERSION} isn't built for this system."),
    }
}

pub(super) async fn ensure(reporter: &ProgressReporter) -> Result<(), String> {
    if installed() {
        return Ok(());
    }
    let archive = node_archive(std::env::consts::OS, std::env::consts::ARCH)
        .ok_or("Node.js isn't built for this system, so Misty can't get it.")?;
    reporter.emit(
        "stdout",
        Some(format!(
            "Getting Node.js {NODE_VERSION} for Misty's engines"
        )),
        None,
    );
    let shasums = downloads::fetch_text(&shasums_url()).await?;
    let checksum: Checksum = downloads::sha256_from_shasums(&shasums, &archive.file)
        .ok_or("nodejs.org's checksum list doesn't name this download.")?;
    let runtime = node_runtime_dir();
    let parent = runtime
        .parent()
        .ok_or("Misty's folder has no place for Node.js.")?
        .to_path_buf();
    let download = parent.join(&archive.file);
    downloads::download_verified(&archive_url(&archive), &download, &checksum, reporter).await?;
    let staging = parent.join(format!("node.partial-{}", uuid::Uuid::new_v4().simple()));
    let unpacked = downloads::unpack(&download, &staging, 1).await;
    let _ = file_access::fs::remove_file(&download);
    if let Err(error) = unpacked {
        let _ = file_access::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let staged_bin = if cfg!(windows) {
        staging.clone()
    } else {
        staging.join("bin")
    };
    if !file_access::fs::is_file(node_in(&staged_bin)) {
        let _ = file_access::fs::remove_dir_all(&staging);
        return Err("The Node.js download didn't hold the program Misty expected.".into());
    }
    if file_access::fs::exists(&runtime) {
        file_access::fs::remove_dir_all(&runtime).map_err(|error| error.to_string())?;
    }
    file_access::fs::rename(&staging, &runtime).map_err(|error| error.to_string())?;
    reporter.emit(
        "stdout",
        Some(format!("Node.js {NODE_VERSION} is ready.")),
        None,
    );
    Ok(())
}
