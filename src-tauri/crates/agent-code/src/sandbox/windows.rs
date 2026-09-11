//! Windows: each project has its own AppContainer (see
//! `misty-windows-confine`). A command may read and change what is inside the
//! project, read its `.git` and `.misty` folders, use its private home and
//! temp folders, and run the toolchains on the person's PATH through a
//! capability those folders are granted. It can't delete or rename the
//! project folder, read or change secret files, reach the person's other
//! files, or use the network. Package installs go through Misty's proxy on
//! macOS; an AppContainer can't reach a proxy on this computer, so on
//! Windows commands run offline.
//!
//! Commands run under cmd.exe (Git Bash's runtime can't start in an
//! AppContainer), on a drive letter mapped to the project while they run:
//! cmd's `dir` and `del` ask about the root of their drive, and a container
//! can't open `C:\`.
//!
//! Granting is idempotent, so every command applies it again, which also
//! narrows a secret file saved since the last command. Every DACL narrowed
//! for a project is recorded, and removing the project puts each back
//! exactly.
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::Arc,
};

use misty_windows_confine::{drive_for, Access, Capability, Container, Drive};
use serde::{Deserialize, Serialize};

use super::{environment, Policy, Setup};
use crate::{beneath, CodeError};

/// The capability every project's commands hold, granted on toolchains.
pub const TOOLS_CAPABILITY: &str = "mistyCodeTools";
/// cmd.exe's own limit is 8,191 characters for a whole command line.
const MAX_COMMAND_CHARS: usize = 8000;
/// Files looked at when finding a project's secrets; a larger project's
/// deeper files are left to the file tools' own name checks.
const MAX_SCANNED: usize = 50_000;
const RECORD: &str = "windows-sandbox.json";

/// How a command starts on Windows.
pub struct Confinement {
    /// The whole command line, as cmd.exe receives it.
    pub command_line: String,
    pub container: String,
    /// The drive the command starts on: its root is the project, which
    /// cmd's `dir` and `del` need (see `misty_windows_confine::drive`).
    pub drive: Arc<Drive>,
}

/// A folder on the person's PATH that commands may use, and the folders the
/// tools capability needs to read for it: the toolchain's own folder when
/// PATH names its `bin`.
#[derive(Clone, Debug)]
pub struct ToolFolder {
    pub entry: PathBuf,
    pub roots: Vec<PathBuf>,
}

/// The AppContainer of the project at `root`: stable for the same folder.
pub fn container_name(root: &Path) -> String {
    // FNV-1a: a fixed hash, so a project keeps its container across
    // versions of Misty.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in root.to_string_lossy().to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("Misty.Code.{hash:016x}")
}

pub fn setup(policy: &Policy, cwd: &Path, command: &str) -> Result<Setup, CodeError> {
    if command.chars().count() > MAX_COMMAND_CHARS {
        return Err(CodeError::fix(
            "That command is too long for cmd.exe (8,000 characters). Write a script file with code_write and run it.",
        ));
    }
    let project = crate::plain_path(policy.project);
    let name = container_name(&project);
    let container = Container::open(&name).map_err(CodeError::Unavailable)?;
    prepare(policy, &container, &name)?;
    let tools = usable_tools(policy.tools);
    let system = system_root();
    let mut path: Vec<String> = [r"System32", "", r"System32\Wbem", r"System32\WindowsPowerShell\v1.0"]
        .iter()
        .map(|folder| system.join(folder).to_string_lossy().trim_end_matches('\\').to_owned())
        .collect();
    path.extend(tools.iter().map(|tool| tool.entry.to_string_lossy().into_owned()));
    let mut env = environment(policy);
    env.remove("TMPDIR");
    let temp = policy.temp.to_string_lossy().into_owned();
    for (name, value) in misty_windows_confine::system_variables() {
        env.insert(name.to_string_lossy().into_owned(), value.to_string_lossy().into_owned());
    }
    for (key, value) in [
        ("PATH", path.join(";")),
        ("PATHEXT", ".COM;.EXE;.BAT;.CMD".to_owned()),
        ("ComSpec", system.join(r"System32\cmd.exe").to_string_lossy().into_owned()),
        ("TEMP", temp.clone()),
        ("TMP", temp),
        ("PIP_CACHE_DIR", policy.home.join("pip-cache").to_string_lossy().into_owned()),
    ] {
        env.insert(key.to_owned(), value);
    }
    let drive = drive_for(&project).map_err(CodeError::Unavailable)?;
    let relative = crate::plain_path(cwd)
        .strip_prefix(&project)
        .map(Path::to_path_buf)
        .map_err(|_| CodeError::Scope("The command folder is outside the project.".into()))?;
    Ok(Setup {
        program: system.join(r"System32\cmd.exe"),
        args: Vec::new(),
        env,
        cwd: drive.join(&relative),
        windows: Confinement {
            command_line: format!("cmd.exe /d /s /c \"{command}\""),
            container: name,
            drive,
        },
    })
}

fn system_root() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
}

/// What a project's grants changed, to undo when it is removed.
#[derive(Default, Serialize, Deserialize)]
struct Record {
    root: PathBuf,
    container: String,
    /// Narrowed path → its DACL before, as SDDL.
    limited: BTreeMap<PathBuf, String>,
}

impl Record {
    fn load(state: &Path) -> Self {
        std::fs::read(state.join(RECORD))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(&self, state: &Path) -> Result<(), CodeError> {
        let failed =
            |error: std::io::Error| CodeError::Unavailable(format!("Could not record the sandbox: {error}"));
        std::fs::create_dir_all(state).map_err(failed)?;
        let partial = state.join(format!("{RECORD}.partial"));
        let bytes = serde_json::to_vec_pretty(self).unwrap_or_default();
        std::fs::write(&partial, bytes)
            .and_then(|_| std::fs::rename(&partial, state.join(RECORD)))
            .map_err(failed)
    }
}

/// Grants the project's container what a command may use, and narrows what
/// it may not.
fn prepare(policy: &Policy, container: &Container, name: &str) -> Result<(), CodeError> {
    let unavailable = |error: String| CodeError::Unavailable(format!("The sandbox couldn't be prepared: {error}"));
    let mut record = Record::load(policy.state);
    if record.root.as_os_str().is_empty() {
        record.root = policy.project.to_path_buf();
        record.container = name.to_owned();
        // Recorded before anything changes, so removal can always find it.
        record.save(policy.state)?;
    }
    container.grant(policy.project, Access::Inside).map_err(unavailable)?;
    let mut narrowed: Vec<(PathBuf, Option<Access>)> = [".git", ".misty"]
        .iter()
        .map(|folder| policy.project.join(folder))
        .filter(|path| std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir()))
        .map(|path| (path, Some(Access::ReadExecute)))
        .collect();
    narrowed.extend(secrets(policy.project).into_iter().map(|path| (path, None)));
    let mut changed = false;
    for (path, access) in narrowed {
        if let Some(original) = container.limit(&path, access).map_err(unavailable)? {
            record.limited.insert(path, original);
            changed = true;
        }
    }
    if changed {
        record.save(policy.state)?;
    }
    for folder in [policy.temp, policy.home] {
        container.grant(folder, Access::Full).map_err(unavailable)?;
    }
    Ok(())
}

/// Secret files in the project, ignored ones included: `.env` files are
/// usually kept out of Git. Dependency folders are skipped.
fn secrets(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let walk = ignore::WalkBuilder::new(root)
        .hidden(false)
        .ignore(false)
        .git_ignore(false)
        .git_exclude(false)
        .git_global(false)
        .parents(false)
        .follow_links(false)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            !matches!(name.as_str(), "node_modules" | ".git" | ".misty" | "target" | ".venv")
        })
        .build();
    for entry in walk.flatten().take(MAX_SCANNED) {
        let is_file = entry.file_type().is_some_and(|kind| kind.is_file());
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if is_file && beneath::is_secret_name(&name) {
            found.push(entry.into_path());
        }
    }
    found
}

/// The tools commands can reach now: those whose folders the capability can
/// read, granting it where the person's own account may.
fn usable_tools(tools: &[ToolFolder]) -> Vec<ToolFolder> {
    let Ok(capability) = Capability::named(TOOLS_CAPABILITY) else {
        return Vec::new();
    };
    tools
        .iter()
        .filter(|tool| {
            tool.roots.iter().all(|root| {
                capability.has(root, Access::ReadExecute).unwrap_or(false)
                    || capability.grant(root, Access::ReadExecute).is_ok()
            })
        })
        .cloned()
        .collect()
}

/// Toolchain folders commands can't use yet because only an administrator
/// can share them (usually installs under Program Files). The rest are
/// shared on the way.
pub fn tools_needing_approval(tools: &[ToolFolder]) -> Vec<PathBuf> {
    let Ok(capability) = Capability::named(TOOLS_CAPABILITY) else {
        return Vec::new();
    };
    let roots: BTreeSet<&PathBuf> = tools.iter().flat_map(|tool| &tool.roots).collect();
    roots
        .into_iter()
        .filter(|root| {
            !capability.has(root, Access::ReadExecute).unwrap_or(false)
                && capability.grant(root, Access::ReadExecute).is_err()
        })
        .cloned()
        .collect()
}

/// The `icacls` arguments that share `root` with the tools capability, to run
/// as an administrator once the person agrees: read and run only.
pub fn approval_arguments(root: &Path) -> Result<Vec<String>, CodeError> {
    let sid = Capability::named(TOOLS_CAPABILITY)
        .and_then(|capability| capability.sid_string())
        .map_err(CodeError::Unavailable)?;
    Ok(vec![
        root.to_string_lossy().into_owned(),
        "/grant".to_owned(),
        format!("*{sid}:(OI)(CI)(RX)"),
        "/Q".to_owned(),
    ])
}

/// The toolchains on the person's PATH. System folders need no grant and are
/// on every command's PATH anyway; app aliases (WindowsApps) can't run in a
/// container; the home folder itself, Misty's data and folders that hold
/// keys are never shared.
pub fn discover_tools(user_home: Option<&Path>, protected: &[PathBuf]) -> Vec<ToolFolder> {
    let Some(path) = std::env::var_os("PATH") else {
        return Vec::new();
    };
    let system = system_root().to_string_lossy().to_lowercase();
    let mut seen = BTreeSet::new();
    std::env::split_paths(&path)
        .filter(|entry| entry.is_absolute() && entry.is_dir())
        .filter(|entry| seen.insert(entry.to_string_lossy().to_lowercase()))
        .filter_map(|entry| {
            let lower = entry.to_string_lossy().to_lowercase();
            if lower.starts_with(&system) || lower.contains(r"\microsoft\windowsapps") {
                return None;
            }
            let roots: Vec<PathBuf> = tool_roots(&entry)
                .into_iter()
                .filter(|root| shareable(root, user_home, protected))
                .collect();
            (!roots.is_empty()).then_some(ToolFolder { entry, roots })
        })
        .collect()
}

/// The folders a PATH entry's tools live in. `…\bin`, `…\cmd` and
/// `…\Scripts` belong to the toolchain above them (Git, Go, a JDK, Python);
/// scoop's shims start programs from its `apps` folder. Links are resolved,
/// so a grant lands on the real folder (nvm points PATH at a link).
fn tool_roots(entry: &Path) -> Vec<PathBuf> {
    let resolved = entry.canonicalize().map(|path| crate::plain_path(&path)).unwrap_or_else(|_| entry.to_path_buf());
    let name = resolved
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let parent = resolved.parent().map(Path::to_path_buf);
    match (name.as_str(), parent) {
        ("shims", Some(parent)) if parent.join("apps").is_dir() => vec![resolved.clone(), parent.join("apps")],
        ("bin" | "cmd" | "scripts", Some(parent))
            if parent.parent().is_some()
                && !parent.file_name().is_some_and(|name| name.to_string_lossy().starts_with('.')) =>
        {
            vec![parent]
        }
        _ => vec![resolved],
    }
}

/// Whether a toolchain folder may be shared with commands.
fn shareable(root: &Path, user_home: Option<&Path>, protected: &[PathBuf]) -> bool {
    if root.parent().is_none() || protected.iter().any(|folder| root.starts_with(folder) || folder.starts_with(root)) {
        return false;
    }
    let Some(home) = user_home else {
        return true;
    };
    if home.starts_with(root) {
        return false;
    }
    let private = [
        ".ssh",
        ".aws",
        ".gnupg",
        ".kube",
        ".docker",
        ".config",
        r"AppData\Roaming\Microsoft",
        r"AppData\Local\Microsoft",
    ];
    !private.iter().any(|folder| root.starts_with(home.join(folder)))
}

/// Undoes everything a project's sandbox changed: each narrowed DACL goes
/// back, the container's rules on the project go, and so does its profile.
pub fn forget(state: &Path) {
    let record = Record::load(state);
    if record.container.is_empty() {
        return;
    }
    if let Ok(container) = Container::open(&record.container) {
        // Narrowed paths first, deepest first, so each inherits the project's
        // change once its own DACL is back.
        let mut limited: Vec<(&PathBuf, &String)> = record.limited.iter().collect();
        limited.sort_by_key(|(path, _)| std::cmp::Reverse(path.components().count()));
        for (path, original) in limited {
            if path.exists() {
                let _ = container.restore(path, original);
            }
        }
        let _ = container.forget(&record.root);
    }
    Container::delete(&record.container);
    let _ = std::fs::remove_file(state.join(RECORD));
}
