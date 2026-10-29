//! Answers a coding tool's permission questions with Misty's rules, the same
//! ones the server applies: reads continue; Ask pauses before every change;
//! Auto continues on edits inside the project and on what the person
//! remembered; anything outside the project root is refused and can never be
//! remembered. Without a valid grant set or lease the bridge fails closed.
use std::path::{Component, Path, PathBuf};

use super::events::{ActionKind, PermissionRequest};

/// The run's mode and what the person remembered for this project.
#[derive(Debug, Clone, Default)]
pub struct BridgeContext {
    /// "ask" or "auto"; anything else is treated as Ask.
    pub mode: String,
    /// A Plan launch: read-only research.
    pub plan: bool,
    pub project_root: PathBuf,
    /// Remembered actions for this project and its remote: project.edit,
    /// project.install, git.push. Empty when the grant set is missing or stale.
    pub grants: Vec<String>,
    /// The lease is current; without it nothing but reads continues.
    pub lease_valid: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    /// Pause and ask the person through the server's approval card.
    AskPerson {
        action: &'static str,
    },
    Deny {
        reason: String,
    },
}

/// The grant action a kind of request needs, if any can cover it.
fn grant_action(kind: ActionKind) -> Option<&'static str> {
    match kind {
        ActionKind::Edit | ActionKind::Run => Some("project.edit"),
        ActionKind::Install => Some("project.install"),
        ActionKind::Push => Some("git.push"),
        _ => None,
    }
}

pub fn decide(request: &PermissionRequest, context: &BridgeContext) -> Decision {
    if let Some(path) = &request.path {
        if !inside(&context.project_root, path) {
            return Decision::Deny {
                reason: "That path is outside the project Misty attached. Work only inside it."
                    .into(),
            };
        }
    }
    if request.kind == ActionKind::Read {
        return Decision::Allow;
    }
    if context.plan {
        return Decision::Deny {
            reason: "This is a read-only planning run. Put the change in the plan instead.".into(),
        };
    }
    if !context.lease_valid {
        return Decision::Deny {
            reason:
                "Misty's lease for this run expired. Stop and report what is left.".into(),
        };
    }
    let action = grant_action(request.kind).unwrap_or("project.edit");
    if context.mode != "auto" {
        return Decision::AskPerson { action };
    }
    match request.kind {
        // Changes inside the attached project are implied by attaching it.
        ActionKind::Edit | ActionKind::Run => Decision::Allow,
        ActionKind::Install | ActionKind::Push
            if context.grants.iter().any(|grant| grant == action) =>
        {
            Decision::Allow
        }
        _ => Decision::AskPerson { action },
    }
}

/// Lexically resolves a path against the project root and checks it stays
/// inside. `..` never climbs out; nothing touches the filesystem.
pub fn inside(root: &Path, path: &str) -> bool {
    let candidate = Path::new(path);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let mut resolved = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                if !resolved.pop() {
                    return false;
                }
            }
            Component::CurDir => {}
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved.starts_with(root)
}

/// Classifies a shell command by what it would do. Reads stay reads; anything
/// unknown runs inside the project and needs the project's permission.
pub fn classify_command(command: &str) -> ActionKind {
    let words: Vec<&str> = command
        .split(|c: char| c.is_whitespace() || c == ';' || c == '&' || c == '|')
        .filter(|w| !w.is_empty())
        .collect();
    let has = |pair: [&str; 2]| words.windows(2).any(|w| w[0] == pair[0] && w[1] == pair[1]);
    if has(["git", "push"]) {
        return ActionKind::Push;
    }
    let installs = [
        ["npm", "install"],
        ["npm", "i"],
        ["npm", "add"],
        ["pnpm", "add"],
        ["pnpm", "install"],
        ["yarn", "add"],
        ["pip", "install"],
        ["pip3", "install"],
        ["cargo", "add"],
        ["cargo", "install"],
        ["brew", "install"],
        ["apt", "install"],
        ["apt-get", "install"],
        ["go", "get"],
        ["go", "install"],
        ["gem", "install"],
        ["uv", "add"],
    ];
    if installs.iter().any(|pair| has(*pair)) {
        return ActionKind::Install;
    }
    if words
        .iter()
        .any(|w| matches!(*w, "curl" | "wget" | "ssh" | "scp"))
    {
        return ActionKind::Network;
    }
    let reads = [
        "ls", "cat", "head", "tail", "grep", "rg", "find", "pwd", "wc", "diff", "echo",
    ];
    let git_reads = ["status", "diff", "log", "show", "branch"];
    match words.as_slice() {
        [] => ActionKind::Other,
        [first, ..] if reads.contains(first) => ActionKind::Read,
        ["git", sub, ..] if git_reads.contains(sub) => ActionKind::Read,
        _ => ActionKind::Run,
    }
}
