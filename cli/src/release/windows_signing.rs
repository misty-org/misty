//! Authenticode checks for a Windows release: the signing certificate is
//! installed before building, and every shipped executable carries a valid,
//! timestamped signature afterwards, as `codesign --verify` checks on macOS.
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::{process::CommandSpec, workspace::Workspace};

/// The newest `signtool.exe` in the installed Windows SDKs.
pub(super) fn signtool() -> Result<PathBuf> {
    let root = std::env::var_os("ProgramFiles(x86)")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"))
        .join(r"Windows Kits\10\bin");
    let mut versions: Vec<PathBuf> = std::fs::read_dir(&root)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .collect()
        })
        .unwrap_or_default();
    // Version folders sort by name (10.0.22621.0 before 10.0.26100.0).
    versions.sort();
    versions
        .iter()
        .rev()
        .map(|version| version.join(r"x64\signtool.exe"))
        .find(|path| path.is_file())
        .context("signtool.exe was not found. Install the Windows SDK signing tools.")
}

/// Fails unless the certificate with `thumbprint` is in the current user's
/// or the machine's personal store, where signing looks for it.
pub(super) fn check_certificate(workspace: &Workspace, thumbprint: &str) -> Result<()> {
    let installed = |machine: bool| {
        let mut command = CommandSpec::new("certutil");
        if !machine {
            command = command.arg("-user");
        }
        command
            .args(["-store", "My", thumbprint])
            .capture(&workspace.misty)
            .is_ok()
    };
    if !installed(false) && !installed(true) {
        bail!("WINDOWS_CERTIFICATE_THUMBPRINT must match a code signing certificate installed in the personal certificate store");
    }
    Ok(())
}

/// Verifies the Authenticode signature of every executable Misty ships from
/// the build `output` folder: the installer, and the app it installs.
pub(super) fn verify(workspace: &Workspace, output: &Path) -> Result<()> {
    let signtool = signtool()?;
    let mut executables = vec![output.join("misty-desktop.exe")];
    executables.extend(
        crate::artifacts::files_under(&output.join("bundle/nsis"))?
            .into_iter()
            .filter(|path| path.extension().is_some_and(|extension| extension == "exe")),
    );
    if executables.len() < 2 {
        bail!("the Windows installer was not produced");
    }
    for executable in executables {
        CommandSpec::new(signtool.as_os_str())
            .args(["verify", "/pa", "/all", "/tw"])
            .arg(executable.as_os_str())
            .run(&workspace.misty)
            .with_context(|| format!("{} is not validly signed", executable.display()))?;
    }
    Ok(())
}
