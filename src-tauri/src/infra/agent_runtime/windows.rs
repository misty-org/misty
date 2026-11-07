//! Which account each person's window is signed in as. On a shared computer one account's run events,
//! questions and connected apps never reach another account's window.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock, PoisonError},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

fn windows() -> &'static Mutex<HashMap<String, String>> {
    static WINDOWS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    WINDOWS.get_or_init(Default::default)
}

pub(crate) fn note_window(label: &str, account: &str) {
    windows().lock().unwrap_or_else(PoisonError::into_inner).insert(label.to_owned(), account.to_owned());
}

pub(crate) fn account_of_window(label: &str) -> Option<String> {
    windows().lock().unwrap_or_else(PoisonError::into_inner).get(label).cloned()
}

fn labels_for(all: &HashMap<String, String>, account: &str) -> Vec<String> {
    all.iter().filter(|(_, held)| account.is_empty() || held.as_str() == account).map(|(label, _)| label.clone()).collect()
}

/// Tells this account's windows. An empty account is a run nobody can place: every signed-in window of
/// a person hears it, as a question nobody can answer would only stop the run.
pub(crate) fn emit_to_account<S: Serialize + Clone>(app: &AppHandle, account: &str, event: &str, payload: S) {
    let labels = labels_for(&windows().lock().unwrap_or_else(PoisonError::into_inner), account);
    for label in labels {
        let _ = app.emit_to(label.as_str(), event, payload.clone());
    }
}

/// The window's account, once it has said which it is.
#[tauri::command]
pub fn agent_window_account(webview: tauri::Webview, account: String) -> Result<(), String> {
    if !crate::infra::profile_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window has an account.".into());
    }
    note_window(webview.label(), &account);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_accounts_own_windows_hear_it() {
        let all = HashMap::from([("window-1".to_owned(), "a".to_owned()), ("window-2".to_owned(), "b".to_owned())]);
        assert_eq!(labels_for(&all, "a"), ["window-1"]);
        assert!(labels_for(&all, "c").is_empty());
        assert_eq!(labels_for(&all, "").len(), 2);
    }
}
