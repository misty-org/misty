//! What a build needs on this computer, and how to get what's missing.

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

pub(super) struct Missing {
    pub tool: &'static str,
    pub fix: String,
}

/// Node 24.12 and npm 11 match `misty doctor desktop`.
pub(super) fn missing(workspace: &Workspace) -> Vec<Missing> {
    let version = |program: &str| {
        CommandSpec::new(program)
            .arg("--version")
            .capture(&workspace.misty)
            .ok()
    };
    let mut problems = Vec::new();
    if !version("node").is_some_and(|found| crate::diagnostics::version_at_least(&found, 24, 12)) {
        problems.push(Missing {
            tool: "Node.js 24.12 or newer",
            fix: install_node().into(),
        });
    }
    if !version(npm()).is_some_and(|found| crate::diagnostics::version_at_least(&found, 11, 0)) {
        problems.push(Missing {
            tool: "npm 11 or newer",
            fix: "npm install --global npm@11".into(),
        });
    }
    if version("cargo").is_none() {
        problems.push(Missing {
            tool: "Rust",
            fix: install_rust().into(),
        });
    }
    if let Some(problem) = native_tools(workspace) {
        problems.push(problem);
    }
    problems
}

fn install_node() -> &'static str {
    if cfg!(windows) {
        "winget install OpenJS.NodeJS"
    } else if cfg!(target_os = "macos") {
        "brew install node"
    } else {
        "install it from nodejs.org"
    }
}

fn install_rust() -> &'static str {
    if cfg!(windows) {
        "winget install Rustlang.Rustup"
    } else {
        "install it from rustup.rs"
    }
}

#[cfg(windows)]
fn native_tools(workspace: &Workspace) -> Option<Missing> {
    let installer = std::env::var_os("ProgramFiles(x86)")
        .map(std::path::PathBuf::from)?
        .join("Microsoft Visual Studio/Installer/vswhere.exe");
    let found = CommandSpec::new(installer)
        .args([
            "-latest",
            "-products",
            "*",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-property",
            "installationPath",
        ])
        .capture(&workspace.misty)
        .is_ok_and(|path| !path.trim().is_empty());
    (!found).then(|| Missing {
        tool: "Visual Studio's C++ build tools",
        fix: "winget install Microsoft.VisualStudio.2022.BuildTools --override \"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive\"".into(),
    })
}

#[cfg(target_os = "macos")]
fn native_tools(workspace: &Workspace) -> Option<Missing> {
    CommandSpec::new("xcrun")
        .arg("--show-sdk-path")
        .capture(&workspace.misty)
        .is_err()
        .then(|| Missing {
            tool: "Xcode's command line tools",
            fix: "xcode-select --install".into(),
        })
}

#[cfg(not(any(windows, target_os = "macos")))]
fn native_tools(_workspace: &Workspace) -> Option<Missing> {
    None
}
