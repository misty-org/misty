// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::types::{Engine, SourceStatus};
use std::path::{Path, PathBuf};

const MAX_DEPTH: usize = 8;

#[derive(Debug, Clone)]
pub(crate) struct SourceSpec {
    pub engine: Engine,
    pub roots: Vec<PathBuf>,
}

#[derive(Debug, Clone)]
pub(crate) struct FoundFile {
    pub path: PathBuf,
    pub root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RootState {
    Ok,
    Missing,
    Denied(String),
    Error(String),
}

#[derive(Debug, Clone)]
pub(crate) struct Discovery {
    pub files: Vec<FoundFile>,
    pub roots: Vec<(PathBuf, RootState)>,
}

impl Discovery {
    pub fn complete(&self) -> bool {
        self.roots
            .iter()
            .all(|(_, state)| matches!(state, RootState::Ok | RootState::Missing))
    }
}

pub(crate) fn default_specs() -> Vec<SourceSpec> {
    Engine::ALL
        .into_iter()
        .map(|engine| SourceSpec {
            engine,
            roots: default_roots(engine),
        })
        .collect()
}

fn default_roots(engine: Engine) -> Vec<PathBuf> {
    match engine {
        Engine::Claude => {
            vec![
                crate::engine_config::support::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude")
                    .join("projects"),
            ]
        }
        Engine::Codex => {
            let homes = vec![crate::engine_config::support::codex_home()];
            homes
                .into_iter()
                .flat_map(|home| [home.join("sessions"), home.join("archived_sessions")])
                .collect()
        }
        Engine::Pi => vec![pi_family_root(".pi")],
        Engine::Omp => vec![pi_family_root(".omp")],
    }
}

fn pi_family_root(home_dir_name: &str) -> PathBuf {
    crate::engine_config::support::engine_home(None, home_dir_name)
        .join("agent")
        .join("sessions")
}

pub(crate) fn discover(spec: &SourceSpec) -> Discovery {
    let mut files = Vec::new();
    let mut roots = Vec::new();
    for root in &spec.roots {
        let state = walk_root(spec.engine, root, &mut files);
        roots.push((root.clone(), state));
    }
    if spec.engine == Engine::Codex {
        files.sort_by(|a, b| {
            a.path
                .file_name()
                .cmp(&b.path.file_name())
                .then(a.path.cmp(&b.path))
        });
    } else {
        files.sort_by(|a, b| a.path.cmp(&b.path));
    }
    Discovery { files, roots }
}

fn walk_root(engine: Engine, root: &Path, out: &mut Vec<FoundFile>) -> RootState {
    let entries = match file_access::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) => return root_error(e),
    };
    let mut stack: Vec<(PathBuf, usize)> = Vec::new();
    let mut current = Some((entries, 0usize));
    while let Some((entries, depth)) = current.take() {
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() && depth + 1 < MAX_DEPTH {
                stack.push((path, depth + 1));
            } else if kind.is_file()
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| engine.accepts_file(name))
            {
                out.push(FoundFile {
                    path,
                    root: root.to_path_buf(),
                });
            }
        }
        while current.is_none() {
            let Some((dir, depth)) = stack.pop() else {
                break;
            };
            current = file_access::fs::read_dir(&dir)
                .ok()
                .map(|entries| (entries, depth));
        }
    }
    RootState::Ok
}

fn root_error(error: std::io::Error) -> RootState {
    match error.kind() {
        std::io::ErrorKind::NotFound => RootState::Missing,
        std::io::ErrorKind::PermissionDenied => RootState::Denied(error.to_string()),
        _ => RootState::Error(error.to_string()),
    }
}

pub(crate) fn status_of(
    spec: &SourceSpec,
    discovery: &Discovery,
    last_scan_at: Option<i64>,
) -> SourceStatus {
    let any_ok = discovery.roots.iter().any(|(_, s)| *s == RootState::Ok);
    let denied = discovery.roots.iter().find_map(|(root, s)| match s {
        RootState::Denied(e) => Some(format!("{}: {e}", root.display())),
        _ => None,
    });
    let failed = discovery.roots.iter().find_map(|(root, s)| match s {
        RootState::Error(e) => Some(format!("{}: {e}", root.display())),
        _ => None,
    });
    let (status, error) = if any_ok {
        ("ok", denied.or(failed))
    } else if let Some(denied) = denied {
        ("denied", Some(denied))
    } else if let Some(failed) = failed {
        ("error", Some(failed))
    } else {
        ("missing", None)
    };
    SourceStatus {
        engine: spec.engine.id().to_string(),
        label: spec.engine.label().to_string(),
        roots: spec
            .roots
            .iter()
            .map(|r| r.to_string_lossy().into_owned())
            .collect(),
        env: spec.engine.env().map(str::to_string),
        files: discovery.files.len() as i64,
        status: status.to_string(),
        error,
        last_scan_at,
    }
}
