#![allow(dead_code)]
use std::path::{Path, PathBuf};

use misty_agent_code::{CodeService, Project};
use serde_json::{json, Value};

pub struct Fixture {
    pub project_dir: tempfile::TempDir,
    pub data_dir: tempfile::TempDir,
    pub outside: tempfile::TempDir,
    pub service: CodeService,
    pub project: Project,
}

pub fn fixture() -> Fixture {
    let project_dir = tempfile::tempdir().unwrap();
    let data_dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let root = plain(&project_dir.path().canonicalize().unwrap());
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    let service = CodeService::new(plain(&data_dir.path().canonicalize().unwrap()), home.map(PathBuf::from));
    // Tests never share the person's own toolchains with the sandbox.
    #[cfg(windows)]
    let service = service.with_tools(Vec::new());
    let project = Project {
        scope_id: "scope_test".into(),
        root,
        allow_installs: false,
    };
    Fixture {
        project_dir,
        data_dir,
        outside,
        service,
        project,
    }
}

impl Drop for Fixture {
    /// Undoes what the project's sandbox changed, as removing it does.
    fn drop(&mut self) {
        self.service.forget(&self.project.scope_id);
    }
}

impl Fixture {
    pub fn root(&self) -> PathBuf {
        self.project.root.clone()
    }

    pub async fn call(&self, operation: &str, input: Value) -> Value {
        misty_agent_code::outcome(self.service.execute(&self.project, "run_1", operation, input).await)
            .unwrap_or_else(|error| json!({ "jobError": error }))
    }

    pub async fn run(&self, command: &str) -> Value {
        self.call("code.run", json!({ "command": command, "timeoutSeconds": 20 })).await
    }
}

/// A path without Windows' verbatim (`\\?\`) prefix, as the app stores project roots.
pub fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

/// A link to a folder: a symlink on unix, a junction on Windows (which needs
/// no privilege, unlike a Windows symlink).
pub fn link_folder(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        // mklink reads a forward slash as the start of a switch.
        let native = |path: &Path| path.to_string_lossy().replace('/', "\\");
        let made = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(native(link))
            .arg(native(target))
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
    }
}

pub fn failed(value: &Value) -> bool {
    value["status"] == "failure" || value.get("jobError").is_some()
}
