use super::*;
use std::cell::RefCell;

const DENIED: Failure = Failure("denied");

#[derive(Default)]
struct Mock {
    secure: RefCell<HashMap<String, String>>,
    legacy: RefCell<HashMap<String, String>>,
    calls: RefCell<Vec<String>>,
    read_error: RefCell<Option<Failure>>,
    write_error: RefCell<Option<Failure>>,
    delete_error: RefCell<Option<Failure>>,
    corrupt_write: bool,
    cleanup_error: bool,
}
impl Backend for Mock {
    fn read(&self, key: &str, allow_prompt: bool) -> Result<Option<Secret>> {
        self.calls.borrow_mut().push(format!("read:{allow_prompt}"));
        if let Some(error) = *self.read_error.borrow() {
            return Err(error);
        }
        Ok(self.secure.borrow().get(key).cloned().map(Zeroizing::new))
    }
    fn write(&self, key: &str, value: &str) -> Result<()> {
        self.calls.borrow_mut().push("write".into());
        if let Some(error) = *self.write_error.borrow() {
            return Err(error);
        }
        self.secure.borrow_mut().insert(
            key.into(),
            if self.corrupt_write { "corrupt" } else { value }.into(),
        );
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.calls.borrow_mut().push("delete".into());
        if let Some(error) = *self.delete_error.borrow() {
            return Err(error);
        }
        self.secure.borrow_mut().remove(key);
        Ok(())
    }
    fn legacy_read(&self, key: &str) -> Result<Option<Secret>> {
        self.calls.borrow_mut().push("legacy_read".into());
        Ok(self.legacy.borrow().get(key).cloned().map(Zeroizing::new))
    }
    fn legacy_delete(&self, key: &str) -> Result<()> {
        self.calls.borrow_mut().push("legacy_delete".into());
        if self.cleanup_error {
            return Err(DENIED);
        }
        self.legacy.borrow_mut().remove(key);
        Ok(())
    }
}

#[test]
fn migration_verifies_keychain_before_removing_file_and_survives_restart() {
    let backend = Mock::default();
    backend
        .legacy
        .borrow_mut()
        .insert("a".into(), "tokens".into());
    let mut state = State::default();
    assert_eq!(
        state.load(&backend, "a").unwrap().unwrap().as_str(),
        "tokens"
    );
    assert_eq!(
        *backend.calls.borrow(),
        [
            "read:true",
            "legacy_read",
            "write",
            "read:false",
            "legacy_delete"
        ]
    );
    assert!(!backend.legacy.borrow().contains_key("a"));
    backend.calls.borrow_mut().clear();
    let mut restarted = State::default();
    assert_eq!(
        restarted.load(&backend, "a").unwrap().unwrap().as_str(),
        "tokens"
    );
    for _ in 0..100 {
        restarted.load(&backend, "a").unwrap();
        restarted.save(&backend, "a", "tokens").unwrap();
    }
    assert_eq!(*backend.calls.borrow(), ["read:true", "legacy_delete"]);
}

#[test]
fn denied_restore_is_attempted_once_and_never_falls_back_to_plaintext() {
    let backend = Mock::default();
    *backend.read_error.borrow_mut() = Some(DENIED);
    backend
        .legacy
        .borrow_mut()
        .insert("a".into(), "tokens".into());
    let mut state = State::default();
    for _ in 0..100 {
        assert_eq!(state.load(&backend, "a").unwrap_err(), DENIED);
    }
    assert_eq!(*backend.calls.borrow(), ["read:true"]);
    assert!(backend.legacy.borrow().contains_key("a"));
}

#[test]
fn failed_write_or_readback_preserves_legacy_login() {
    for backend in [
        Mock {
            write_error: RefCell::new(Some(DENIED)),
            ..Mock::default()
        },
        Mock {
            corrupt_write: true,
            ..Mock::default()
        },
    ] {
        backend
            .legacy
            .borrow_mut()
            .insert("a".into(), "tokens".into());
        let mut state = State::default();
        assert!(state.load(&backend, "a").is_err());
        assert!(backend.legacy.borrow().contains_key("a"));
        assert!(!backend.calls.borrow().contains(&"legacy_delete".into()));
        let calls = backend.calls.borrow().len();
        assert!(state.load(&backend, "a").is_err());
        assert_eq!(backend.calls.borrow().len(), calls);
    }
}

#[test]
fn keychain_wins_after_interrupted_migration() {
    let backend = Mock::default();
    backend
        .legacy
        .borrow_mut()
        .insert("a".into(), "stale".into());
    backend
        .secure
        .borrow_mut()
        .insert("a".into(), "rotated".into());
    let mut state = State::default();
    assert_eq!(
        state.load(&backend, "a").unwrap().unwrap().as_str(),
        "rotated"
    );
    assert!(!backend.calls.borrow().contains(&"legacy_read".into()));
    assert!(backend.legacy.borrow().is_empty());
}

#[test]
fn rotation_is_saved_once_without_an_interactive_read() {
    let backend = Mock::default();
    let mut state = State::default();
    state.save(&backend, "a", "old").unwrap();
    backend.calls.borrow_mut().clear();
    for _ in 0..100 {
        state.save(&backend, "a", "new").unwrap();
    }
    assert_eq!(
        *backend.calls.borrow(),
        ["write", "read:false", "legacy_delete"]
    );
    assert_eq!(state.load(&backend, "a").unwrap().unwrap().as_str(), "new");
    assert_eq!(
        State::default()
            .load(&backend, "a")
            .unwrap()
            .unwrap()
            .as_str(),
        "new"
    );
}

#[test]
fn failed_rotation_cannot_restore_a_stale_cached_refresh_token() {
    let backend = Mock::default();
    let mut state = State::default();
    state.save(&backend, "a", "old").unwrap();
    *backend.write_error.borrow_mut() = Some(DENIED);
    assert!(state.save(&backend, "a", "new").is_err());
    assert!(state.load(&backend, "a").is_err());
    *backend.write_error.borrow_mut() = None;
    state.save(&backend, "a", "new").unwrap();
    assert_eq!(state.load(&backend, "a").unwrap().unwrap().as_str(), "new");
}

#[test]
fn forgetting_removes_both_stores_and_only_the_selected_account() {
    let backend = Mock::default();
    let mut state = State::default();
    for key in ["a", "b"] {
        state.save(&backend, key, key).unwrap();
        backend
            .legacy
            .borrow_mut()
            .insert(key.into(), "stale".into());
    }
    state.delete(&backend, "a").unwrap();
    assert!(state.load(&backend, "a").unwrap().is_none());
    assert!(State::default().load(&backend, "a").unwrap().is_none());
    assert_eq!(state.load(&backend, "b").unwrap().unwrap().as_str(), "b");
    assert!(backend.legacy.borrow().contains_key("b"));
    assert!(!backend.secure.borrow().contains_key("a"));
}

#[test]
fn failed_delete_does_not_report_success_or_restore_cached_credentials() {
    let backend = Mock::default();
    let mut state = State::default();
    state.save(&backend, "a", "tokens").unwrap();
    *backend.delete_error.borrow_mut() = Some(DENIED);
    assert!(state.delete(&backend, "a").is_err());
    assert!(state.load(&backend, "a").is_err());
}

#[test]
fn cleanup_failure_does_not_claim_migration_succeeded() {
    let backend = Mock {
        cleanup_error: true,
        ..Mock::default()
    };
    backend
        .legacy
        .borrow_mut()
        .insert("a".into(), "tokens".into());
    assert!(State::default().load(&backend, "a").is_err());
    assert!(backend.legacy.borrow().contains_key("a"));
}
