use std::{
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

use serde::Serialize;

use super::{blocking, failed, person_window};

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

static STACKS: LazyLock<Mutex<Stacks>> = LazyLock::new(Mutex::default);

fn stacks() -> std::sync::MutexGuard<'static, Stacks> {
    STACKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn record(label: &'static str, change: Change) {
    stacks().record(label, change);
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redo: Option<String>,
}

fn revert(change: Change) -> Result<Change, String> {
    match change {
        Change::Created(path) => trash_again(vec![path]),
        Change::Copied(paths) => trash_again(paths),
        Change::Renamed { from, to } => {
            super::ops::rename_path(&to, &from)
                .map_err(|error| failed(&to, super::listing::io_text(&error)))?;
            super::search::note_renamed(&to, &from);
            Ok(Change::Renamed { from: to, to: from })
        }
        Change::Moved(pairs) => {
            let mut back = Vec::new();
            let mut first_error = None;
            for (from, to) in pairs {
                if file_access::disk::fs_disk::exists(&from) {
                    first_error.get_or_insert_with(|| {
                        failed(&from, "An item with that name is already there.")
                    });
                    continue;
                }
                match super::transfer::move_or_copy(&to, &from) {
                    Ok(()) => {
                        super::search::note_renamed(&to, &from);
                        back.push((to, from));
                    }
                    Err(error) => {
                        first_error
                            .get_or_insert_with(|| failed(&to, super::listing::io_text(&error)));
                    }
                }
            }
            match (back.is_empty(), first_error) {
                (true, Some(error)) => Err(error),
                _ => Ok(Change::Moved(back)),
            }
        }
        Change::Trashed(ids) => {
            let result = super::trash::put_back_ids(&ids);
            if result.created.is_empty() {
                if let Some(failure) = result.failed.into_iter().next() {
                    return Err(failure.error);
                }
            }
            Ok(Change::Copied(
                result.created.into_iter().map(PathBuf::from).collect(),
            ))
        }
    }
}

fn trash_again(paths: Vec<PathBuf>) -> Result<Change, String> {
    let (trashed, failures) = super::trash::trash_paths(&paths);
    if trashed.is_empty() {
        if let Some(failure) = failures.into_iter().next() {
            return Err(failure.error);
        }
    }
    Ok(Change::Trashed(
        trashed.into_iter().map(|item| item.id).collect(),
    ))
}

fn step(undoing: bool) -> Result<UndoState, String> {
    let taken = {
        let mut stacks = stacks();
        if undoing {
            stacks.undo.pop()
        } else {
            stacks.redo.pop()
        }
    };
    let Some((label, change)) = taken else {
        return Ok(stacks().state());
    };
    let done = revert(change);
    let mut stacks = stacks();
    match done {
        Ok(opposite) => {
            if undoing {
                stacks.redo.push((label, opposite));
            } else {
                stacks.undo.push((label, opposite));
            }
            Ok(stacks.state())
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub fn files_undo_state(webview: tauri::Webview) -> Result<UndoState, String> {
    person_window(&webview)?;
    Ok(stacks().state())
}

#[tauri::command]
pub async fn files_undo(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<UndoState, String> {
    person_window(&webview)?;
    blocking(move || {
        super::trash::attach(&app);
        step(true)
    })
    .await
}

#[tauri::command]
pub async fn files_redo(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<UndoState, String> {
    person_window(&webview)?;
    blocking(move || {
        super::trash::attach(&app);
        step(false)
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
}
