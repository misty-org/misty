use super::*;
use tempfile::TempDir;
struct Fixture {
    temp: TempDir,
    root: PathBuf,
    engine: Organizer,
    snapshot: Snapshot,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("selected");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("invoice.txt"), "original invoice").unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("nested/invoice.txt"), "second invoice").unwrap();
        let mut engine = Organizer::new(temp.path().join("journal")).unwrap();
        let snapshot = engine.grant("alice", &root).unwrap();
        Self {
            temp,
            root,
            engine,
            snapshot,
        }
    }
    fn source(&self, name: &str) -> String {
        self.snapshot
            .items
            .iter()
            .find(|i| i.relative_path == name)
            .unwrap()
            .id
            .clone()
    }
    fn plan(&self) -> Manifest {
        self.engine
            .prepare(
                "alice",
                &self.snapshot.grant_id,
                &Uuid::new_v4().to_string(),
                vec![
                    Step::Mkdir {
                        destination: "Invoices".into(),
                    },
                    Step::Move {
                        source_id: self.source("invoice.txt"),
                        destination: "Invoices/first.txt".into(),
                    },
                    Step::Move {
                        source_id: self.source("nested/invoice.txt"),
                        destination: "Invoices/second.txt".into(),
                    },
                ],
            )
            .unwrap()
    }
}
#[test]
fn moves_nested_duplicates_replays_and_undoes() {
    let f = Fixture::new();
    let plan = f.plan();
    let done = f.engine.apply("alice", &plan.id, || false).unwrap();
    assert_eq!(done.state, "completed");
    assert_eq!(
        fs::read_to_string(f.root.join("Invoices/first.txt")).unwrap(),
        "original invoice"
    );
    assert_eq!(
        f.engine
            .apply("alice", &plan.id, || false)
            .unwrap()
            .receipts
            .len(),
        3
    );
    let undone = f.engine.undo("alice", &plan.id).unwrap();
    assert_eq!(undone.state, "undone");
    assert!(f.root.join("invoice.txt").exists());
    assert!(f.root.join("nested/invoice.txt").exists());
    assert!(!f.root.join("Invoices").exists());
}
#[test]
fn collision_and_stale_source_never_overwrite() {
    let f = Fixture::new();
    let plan = f.plan();
    fs::write(f.root.join("invoice.txt"), "changed").unwrap();
    let result = f.engine.apply("alice", &plan.id, || false).unwrap();
    assert_eq!(result.state, "needs_review");
    assert_eq!(
        fs::read_to_string(f.root.join("invoice.txt")).unwrap(),
        "changed"
    );
    let other = Fixture::new();
    let plan = other.plan();
    fs::create_dir(other.root.join("Invoices")).unwrap();
    fs::write(other.root.join("Invoices/first.txt"), "keep me").unwrap();
    assert_eq!(
        other
            .engine
            .apply("alice", &plan.id, || false)
            .unwrap()
            .state,
        "needs_review"
    );
    assert_eq!(
        fs::read_to_string(other.root.join("Invoices/first.txt")).unwrap(),
        "keep me"
    );
}
#[test]
fn pause_restart_and_revocation() {
    let mut f = Fixture::new();
    let plan = f.plan();
    let calls = std::cell::Cell::new(0);
    let paused = f
        .engine
        .apply("alice", &plan.id, || {
            calls.set(calls.get() + 1);
            calls.get() > 1
        })
        .unwrap();
    assert_eq!(paused.state, "paused");
    assert!(f.root.join("invoice.txt").exists());
    let restored = Organizer::new(f.temp.path().join("journal")).unwrap();
    assert_eq!(
        restored.apply("alice", &plan.id, || false).unwrap().state,
        "completed"
    );
    assert!(restored.manifest("bob", &plan.id).is_err());
    assert_eq!(
        restored
            .snapshot("alice", &f.snapshot.grant_id)
            .unwrap()
            .grant_id,
        f.snapshot.grant_id
    );
    assert!(restored.snapshot("bob", &f.snapshot.grant_id).is_err());
    f.engine.revoke("alice", &f.snapshot.grant_id).unwrap();
    assert!(f.engine.undo("alice", &plan.id).is_err());
    assert!(f.engine.snapshot("alice", &f.snapshot.grant_id).is_err());
}
#[test]
fn rejects_escapes_symlinks_and_reused_plan_identity() {
    let f = Fixture::new();
    std::os::unix::fs::symlink(f.temp.path(), f.root.join("escape")).unwrap();
    for destination in [
        "../escape.txt",
        "/tmp/escape.txt",
        "escape/outside.txt",
        ".secret/hidden.txt",
    ] {
        assert!(
            f.engine
                .prepare(
                    "alice",
                    &f.snapshot.grant_id,
                    &Uuid::new_v4().to_string(),
                    vec![Step::Move {
                        source_id: f.source("invoice.txt"),
                        destination: destination.into()
                    }]
                )
                .is_err(),
            "{destination}"
        );
    }
    let plan = f.plan();
    assert!(f
        .engine
        .prepare("bob", &f.snapshot.grant_id, &plan.id, plan.steps.clone())
        .is_err());
    assert!(f
        .engine
        .prepare(
            "alice",
            &f.snapshot.grant_id,
            &plan.id,
            vec![Step::Mkdir {
                destination: "Other".into()
            }]
        )
        .is_err());
}
#[test]
fn reconciles_crash_after_rename_without_repeating() {
    let f = Fixture::new();
    let mut plan = f.plan();
    plan.receipts[0].state = "completed".into();
    fs::create_dir(f.root.join("Invoices")).unwrap();
    plan.receipts[1].state = "applying".into();
    fs::rename(
        f.root.join("invoice.txt"),
        f.root.join("Invoices/first.txt"),
    )
    .unwrap();
    f.engine.save(&plan.id, "manifest", &plan).unwrap();
    assert_eq!(
        f.engine.apply("alice", &plan.id, || false).unwrap().state,
        "completed"
    );
}
#[test]
fn undo_refuses_changed_destination() {
    let f = Fixture::new();
    let plan = f.plan();
    f.engine.apply("alice", &plan.id, || false).unwrap();
    fs::write(f.root.join("Invoices/second.txt"), "new content").unwrap();
    assert_eq!(
        f.engine.undo("alice", &plan.id).unwrap().state,
        "needs_review"
    );
    assert_eq!(
        fs::read_to_string(f.root.join("Invoices/second.txt")).unwrap(),
        "new content"
    );
}
#[test]
fn destination_symlink_inserted_after_planning_is_never_followed() {
    let f = Fixture::new();
    let plan = f.plan();
    let outside = f.temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, f.root.join("Invoices")).unwrap();
    assert_eq!(
        f.engine.apply("alice", &plan.id, || false).unwrap().state,
        "needs_review"
    );
    assert!(f.root.join("invoice.txt").exists());
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}
#[test]
fn root_replacement_is_denied_and_receipts_survive_revocation() {
    let mut f = Fixture::new();
    let plan = f.plan();
    fs::rename(&f.root, f.temp.path().join("old")).unwrap();
    fs::create_dir(&f.root).unwrap();
    assert!(f.engine.apply("alice", &plan.id, || false).is_err());
    f.engine.revoke("alice", &f.snapshot.grant_id).unwrap();
    assert_eq!(f.engine.history("alice").unwrap().len(), 1);
    assert!(f.engine.history("bob").unwrap().is_empty());
}

#[test]
fn inaccessible_items_are_excluded_without_losing_readable_files() {
    use std::os::unix::fs::PermissionsExt;
    let mut f = Fixture::new();
    let protected = f.root.join("protected.txt");
    fs::write(&protected, "not available to the organizer").unwrap();
    fs::set_permissions(&protected, fs::Permissions::from_mode(0o000)).unwrap();
    let snapshot = f.engine.grant("alice", &f.root);
    // Restore permissions before any assertion so fixture cleanup always works.
    fs::set_permissions(&protected, fs::Permissions::from_mode(0o600)).unwrap();
    let snapshot = snapshot.unwrap();
    assert!(snapshot
        .items
        .iter()
        .any(|item| item.relative_path == "invoice.txt"));
    assert!(!snapshot
        .items
        .iter()
        .any(|item| item.relative_path == "protected.txt"));
    assert!(snapshot
        .excluded
        .iter()
        .any(|item| item == "protected.txt: inaccessible"));
}
