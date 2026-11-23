use std::{
    collections::HashMap,
    ffi::OsStr,
    io,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

use file_access::disk::{place, walk};
use file_access::Access;
use serde::Serialize;

use super::listing::io_text;
use super::{blocking, failed, gated, person_window};

#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    Created(PathBuf),
    Renamed { from: PathBuf, to: PathBuf },
    Moved(Vec<(PathBuf, PathBuf)>),
    Copied(Vec<PathBuf>),
    Trashed(Vec<String>),
}

const MOST: usize = 50;

#[derive(Default)]
struct Stacks {
    undo: Vec<(&'static str, Change)>,
    redo: Vec<(&'static str, Change)>,
}

impl Stacks {
    fn record(&mut self, label: &'static str, change: Change) {
        self.undo.push((label, change));
        if self.undo.len() > MOST {
            let extra = self.undo.len() - MOST;
            self.undo.drain(..extra);
        }
        self.redo.clear();
    }

    fn state(&self) -> UndoState {
        UndoState {
            undo: self.undo.last().map(|(label, _)| format!("Undo {label}")),
            redo: self.redo.last().map(|(label, _)| format!("Redo {label}")),
        }
    }
}

static WINDOWS: LazyLock<Mutex<HashMap<String, Stacks>>> = LazyLock::new(Mutex::default);

fn windows() -> std::sync::MutexGuard<'static, HashMap<String, Stacks>> {
    WINDOWS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn record(window: &str, label: &'static str, change: Change) {
    windows()
        .entry(window.to_owned())
        .or_default()
        .record(label, change);
}

fn state_of(window: &str) -> UndoState {
    windows().get(window).map(Stacks::state).unwrap_or_default()
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redo: Option<String>,
}

struct Reverted {
    opposite: Option<Change>,
    left: Option<Change>,
    error: Option<String>,
}

impl Reverted {
    fn done(opposite: Change) -> Self {
        Self {
            opposite: Some(opposite),
            left: None,
            error: None,
        }
    }

    fn failed(change: Change, error: String) -> Self {
        Self {
            opposite: None,
            left: Some(change),
            error: Some(error),
        }
    }
}

#[cfg(unix)]
fn crosses_drives(error: &io::Error) -> bool {
    error.raw_os_error() == Some(libc::EXDEV)
}

#[cfg(windows)]
fn crosses_drives(error: &io::Error) -> bool {
    error.raw_os_error() == Some(17)
}

fn name_of(path: &Path) -> io::Result<&OsStr> {
    gated::split(path).map(|(_, name)| name)
}

pub(crate) fn move_back(from: &Path, to: &Path) -> io::Result<()> {
    let (from_dir, from_name) = gated::parent(from, Access::Write)?;
    let (to_dir, to_name) = gated::parent(to, Access::Write)?;
    match place::rename_new(&from_dir, &from_name, &to_dir, &to_name) {
        Err(error) if crosses_drives(&error) => {
            let outcome = walk::copy_tree_checked(
                from,
                to_dir.path(),
                name_of(to)?,
                walk::WalkFor::Person,
                &mut |_, _| true,
            )?;
            if outcome.cancelled {
                return Err(gated::cancelled());
            }
            if let Some((path, why)) = outcome.skipped.first() {
                return Err(io::Error::other(format!(
                    "{} couldn't be moved back: {why}",
                    path.display()
                )));
            }
            walk::remove_tree_checked(from, walk::WalkFor::Person, &mut |_| true)
        }
        other => other,
    }
}

fn revert_moves(pairs: Vec<(PathBuf, PathBuf)>) -> Reverted {
    let (mut back, mut left, mut first_error) = (Vec::new(), Vec::new(), None);
    for (from, to) in pairs {
        match move_back(&to, &from) {
            Ok(()) => {
                super::search::note_renamed(&to, &from);
                back.push((to, from));
            }
            Err(error) => {
                first_error.get_or_insert_with(|| failed(&to, io_text(&error)));
                left.push((from, to));
            }
        }
    }
    Reverted {
        opposite: (!back.is_empty()).then_some(Change::Moved(back)),
        left: (!left.is_empty()).then_some(Change::Moved(left)),
        error: first_error,
    }
}

fn revert(change: Change) -> Reverted {
    match change {
        Change::Created(path) => trash_again(vec![path], |left| {
            Change::Created(left.into_iter().next().unwrap_or_default())
        }),
        Change::Copied(paths) => trash_again(paths, Change::Copied),
        Change::Renamed { from, to } => match move_back(&to, &from) {
            Ok(()) => {
                super::search::note_renamed(&to, &from);
                Reverted::done(Change::Renamed { from: to, to: from })
            }
            Err(error) => {
                let text = failed(&to, io_text(&error));
                Reverted::failed(Change::Renamed { from, to }, text)
            }
        },
        Change::Moved(pairs) => revert_moves(pairs),
        Change::Trashed(ids) => {
            let (result, left) = super::trash::put_back_ids(&ids);
            Reverted {
                opposite: (!result.created.is_empty())
                    .then(|| Change::Copied(result.created.iter().map(PathBuf::from).collect())),
                left: (!left.is_empty()).then_some(Change::Trashed(left)),
                error: result
                    .failed
                    .into_iter()
                    .next()
                    .map(|failure| failure.error),
            }
        }
    }
}

fn trash_again(paths: Vec<PathBuf>, keep: impl Fn(Vec<PathBuf>) -> Change) -> Reverted {
    let (trashed, failures) = super::trash::trash_paths(&paths);
    let missing: Vec<PathBuf> = failures
        .iter()
        .map(|failure| PathBuf::from(&failure.path))
        .collect();
    Reverted {
        opposite: (!trashed.is_empty())
            .then(|| Change::Trashed(trashed.into_iter().map(|item| item.id).collect())),
        left: (!missing.is_empty()).then(|| keep(missing)),
        error: failures.into_iter().next().map(|failure| failure.error),
    }
}

fn step(window: &str, undoing: bool) -> Result<UndoState, String> {
    let taken = {
        let mut windows = windows();
        let stacks = windows.entry(window.to_owned()).or_default();
        if undoing {
            stacks.undo.pop()
        } else {
            stacks.redo.pop()
        }
    };
    let Some((label, change)) = taken else {
        return Ok(state_of(window));
    };
    let reverted = revert(change);
    let nothing_done = reverted.opposite.is_none();
    {
        let mut windows = windows();
        let stacks = windows.entry(window.to_owned()).or_default();
        if let Some(left) = reverted.left {
            if undoing {
                stacks.undo.push((label, left));
            } else {
                stacks.redo.push((label, left));
            }
        }
        if let Some(opposite) = reverted.opposite {
            if undoing {
                stacks.redo.push((label, opposite));
            } else {
                stacks.undo.push((label, opposite));
            }
        }
    }
    match reverted.error {
        Some(error) if nothing_done => Err(error),
        _ => Ok(state_of(window)),
    }
}

#[tauri::command]
pub async fn files_undo_state(webview: tauri::Webview) -> Result<UndoState, String> {
    person_window(&webview)?;
    let window = webview.label().to_owned();
    blocking(move || Ok(state_of(&window))).await
}

#[tauri::command]
pub async fn files_undo(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<UndoState, String> {
    person_window(&webview)?;
    let window = webview.label().to_owned();
    blocking(move || {
        super::trash::attach(&app);
        step(&window, true)
    })
    .await
}

#[tauri::command]
pub async fn files_redo(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<UndoState, String> {
    person_window(&webview)?;
    let window = webview.label().to_owned();
    blocking(move || {
        super::trash::attach(&app);
        step(&window, false)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn renamed(n: usize) -> Change {
        Change::Renamed {
            from: PathBuf::from(format!("/a/{n}")),
            to: PathBuf::from(format!("/b/{n}")),
        }
    }

    #[test]
    fn the_stack_keeps_the_last_fifty_and_names_the_newest() {
        let mut stacks = Stacks::default();
        assert_eq!(stacks.state(), UndoState::default());
        for n in 0..60 {
            stacks.record("Rename", renamed(n));
        }
        stacks.record("Move", Change::Moved(Vec::new()));
        assert_eq!(stacks.undo.len(), MOST);
        assert_eq!(stacks.undo[0].1, renamed(11));
        assert_eq!(stacks.state().undo.as_deref(), Some("Undo Move"));
        assert_eq!(stacks.state().redo, None);
    }

    #[test]
    fn a_new_change_clears_redo() {
        let mut stacks = Stacks::default();
        stacks.redo.push(("Rename", renamed(1)));
        assert_eq!(stacks.state().redo.as_deref(), Some("Redo Rename"));
        stacks.record("Copy", Change::Copied(Vec::new()));
        assert!(stacks.redo.is_empty());
    }

    #[test]
    fn each_window_keeps_its_own_stack() {
        let one = format!("test-{}", uuid::Uuid::new_v4());
        let two = format!("test-{}", uuid::Uuid::new_v4());
        record(&one, "Rename", renamed(1));
        assert_eq!(state_of(&one).undo.as_deref(), Some("Undo Rename"));
        assert_eq!(state_of(&two), UndoState::default());
    }

    #[test]
    fn a_failed_undo_keeps_its_entry_and_never_replaces() {
        let root = tempfile::tempdir().expect("temp folder");
        let root = file_access::fs::canonicalize(root.path()).expect("real path");
        let (from, to) = (root.join("old.txt"), root.join("new.txt"));
        file_access::fs::write(&from, b"someone else").expect("write");
        file_access::fs::write(&to, b"renamed").expect("write");
        let window = format!("test-{}", uuid::Uuid::new_v4());
        record(
            &window,
            "Rename",
            Change::Renamed {
                from: from.clone(),
                to: to.clone(),
            },
        );
        assert!(step(&window, true).is_err());
        assert_eq!(state_of(&window).undo.as_deref(), Some("Undo Rename"));
        assert_eq!(file_access::fs::read(&from).expect("read"), b"someone else");
        assert_eq!(file_access::fs::read(&to).expect("read"), b"renamed");
        file_access::fs::remove_file(&from).expect("remove");
        assert!(step(&window, true).is_ok());
        assert_eq!(file_access::fs::read(&from).expect("read"), b"renamed");
        assert_eq!(state_of(&window).redo.as_deref(), Some("Redo Rename"));
    }
}
