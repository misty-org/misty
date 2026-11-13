// Fixtures are built with the standard file calls, as tests may (`src-tauri/clippy.toml`).
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]
use super::*;
use std::fs;

struct Place {
    root: tempfile::TempDir,
    folder: tempfile::TempDir,
}

impl Place {
    fn new() -> Self {
        Self {
            root: tempfile::tempdir().unwrap(),
            folder: tempfile::tempdir().unwrap(),
        }
    }
    fn folder(&self) -> &Path {
        self.folder.path()
    }
    fn write(&self, path: &str, text: &str) {
        let full = self.folder().join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, text).unwrap();
    }
    fn read(&self, path: &str) -> Option<String> {
        fs::read_to_string(self.folder().join(path)).ok()
    }
    fn snap(&self) -> Oid {
        snapshot(self.root.path(), self.folder()).unwrap()
    }
    fn plan(&self, turns: &[Turn]) -> Plan {
        let now = self.snap();
        let repository = repository(self.root.path(), self.folder()).unwrap();
        plan(&repository, turns, now).unwrap()
    }
    fn restore_all(&self, plan: &Plan) -> Vec<String> {
        let paths: Vec<String> = plan.files.iter().map(|file| file.path.clone()).collect();
        restore(
            self.root.path(),
            self.folder(),
            plan.target.unwrap(),
            &paths,
        )
        .unwrap()
    }
}

fn turn(before: Oid, after: Oid) -> Turn {
    Turn {
        before: Some(before),
        after: Some(after),
    }
}

fn paths(plan: &Plan) -> Vec<(&str, &str, bool)> {
    plan.files
        .iter()
        .map(|file| (file.path.as_str(), file.change, file.changed_by_you))
        .collect()
}

#[test]
fn puts_back_what_the_agent_changed_and_takes_away_what_it_made() {
    let place = Place::new();
    place.write("src/main.rs", "fn main() {}\n");
    place.write("README.md", "hello\n");
    let before = place.snap();
    place.write("src/main.rs", "fn main() { broken }\n");
    place.write("src/new/extra.rs", "// made by the agent\n");
    fs::remove_file(place.folder().join("README.md")).unwrap();
    let after = place.snap();

    let plan = place.plan(&[turn(before, after)]);
    assert_eq!(
        paths(&plan),
        vec![
            ("README.md", "restore", false),
            ("src/main.rs", "restore", false),
            ("src/new/extra.rs", "remove", false),
        ]
    );
    assert!(!plan.incomplete);
    assert!(place.restore_all(&plan).is_empty());
    assert_eq!(place.read("src/main.rs").as_deref(), Some("fn main() {}\n"));
    assert_eq!(place.read("README.md").as_deref(), Some("hello\n"));
    assert!(
        !place.folder().join("src/new").exists(),
        "the empty folder it made goes too"
    );
    assert!(place.folder().join("src").is_dir());
    assert!(place.plan(&[turn(before, after)]).files.is_empty());
}

#[test]
fn a_file_the_person_changed_since_waits_for_them() {
    let place = Place::new();
    place.write("a.txt", "one\n");
    place.write("b.txt", "one\n");
    let before = place.snap();
    place.write("a.txt", "agent\n");
    place.write("b.txt", "agent\n");
    let after = place.snap();
    // The person edits one of the agent's files afterwards, and one of their own.
    place.write("b.txt", "person\n");
    place.write("notes.txt", "mine\n");

    let plan = place.plan(&[turn(before, after)]);
    assert_eq!(
        paths(&plan),
        vec![("a.txt", "restore", false), ("b.txt", "restore", true)]
    );
    // Putting back only the agent's own leaves the person's work alone.
    let failed = restore(
        place.root.path(),
        place.folder(),
        plan.target.unwrap(),
        &["a.txt".to_string()],
    )
    .unwrap();
    assert!(failed.is_empty());
    assert_eq!(place.read("a.txt").as_deref(), Some("one\n"));
    assert_eq!(place.read("b.txt").as_deref(), Some("person\n"));
    assert_eq!(place.read("notes.txt").as_deref(), Some("mine\n"));
}

#[test]
fn an_edit_between_removed_turns_counts_as_the_persons() {
    let place = Place::new();
    place.write("a.txt", "one\n");
    let first_before = place.snap();
    place.write("a.txt", "agent\n");
    let first_after = place.snap();
    place.write("a.txt", "person\n");
    let second_before = place.snap();
    place.write("c.txt", "agent again\n");
    let second_after = place.snap();

    let plan = place.plan(&[
        turn(first_before, first_after),
        turn(second_before, second_after),
    ]);
    assert_eq!(
        paths(&plan),
        vec![("a.txt", "restore", true), ("c.txt", "remove", false)]
    );
}

#[test]
fn a_change_the_agent_undid_itself_is_left_out() {
    let place = Place::new();
    place.write("a.txt", "one\n");
    let first_before = place.snap();
    place.write("a.txt", "two\n");
    let first_after = place.snap();
    place.write("a.txt", "one\n");
    let second_after = place.snap();

    let plan = place.plan(&[
        turn(first_before, first_after),
        turn(first_after, second_after),
    ]);
    assert!(plan.files.is_empty());
}

#[test]
fn a_turn_whose_end_was_not_saved_could_be_anyones() {
    let place = Place::new();
    place.write("a.txt", "one\n");
    let before = place.snap();
    place.write("a.txt", "two\n");

    let plan = place.plan(&[Turn {
        before: Some(before),
        after: None,
    }]);
    assert!(plan.incomplete);
    assert_eq!(paths(&plan), vec![("a.txt", "restore", true)]);
}

#[test]
fn a_turn_whose_start_was_not_saved_has_nothing_to_go_back_to() {
    let place = Place::new();
    place.write("a.txt", "one\n");
    let after = place.snap();
    let plan = place.plan(&[Turn {
        before: None,
        after: Some(after),
    }]);
    assert!(plan.incomplete);
    assert!(plan.target.is_none());
    assert!(plan.files.is_empty());
}

#[test]
fn ignored_files_are_never_saved_or_touched() {
    let place = Place::new();
    place.write(".gitignore", "build/\n");
    place.write("build/out.bin", "old\n");
    place.write("node_modules/pkg/index.js", "old\n");
    let before = place.snap();
    place.write("build/out.bin", "new\n");
    place.write("node_modules/pkg/index.js", "new\n");
    let after = place.snap();
    assert_eq!(before, after);
    assert!(place.plan(&[turn(before, after)]).files.is_empty());
}

#[test]
fn the_folders_own_repository_is_left_alone() {
    let place = Place::new();
    let own = Repository::init(place.folder()).unwrap();
    place.write("a.txt", "one\n");
    let nested = place.folder().join("vendor/lib");
    fs::create_dir_all(&nested).unwrap();
    Repository::init(&nested).unwrap();
    fs::write(nested.join("x.txt"), "nested\n").unwrap();
    let before = place.snap();
    place.write("a.txt", "two\n");
    fs::write(nested.join("x.txt"), "changed\n").unwrap();
    let after = place.snap();

    let plan = place.plan(&[turn(before, after)]);
    assert_eq!(paths(&plan), vec![("a.txt", "restore", false)]);
    // Misty's store is elsewhere: the folder's own index never learns about any of this.
    assert!(own.index().unwrap().is_empty());
    assert!(place.folder().join(".git").is_dir());
}

#[test]
fn the_folder_gets_no_git_link_of_misty() {
    let place = Place::new();
    place.write("a.txt", "one\n");
    place.snap();
    assert!(!place.folder().join(".git").exists());
}

#[cfg(unix)]
#[test]
fn a_program_stays_a_program() {
    use std::os::unix::fs::PermissionsExt;
    let place = Place::new();
    place.write("run.sh", "#!/bin/sh\necho one\n");
    let script = place.folder().join("run.sh");
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    let before = place.snap();
    fs::remove_file(&script).unwrap();
    let after = place.snap();

    let plan = place.plan(&[turn(before, after)]);
    assert!(place.restore_all(&plan).is_empty());
    let mode = fs::metadata(&script).unwrap().permissions().mode();
    assert_eq!(mode & 0o111, 0o111);
}

#[test]
fn a_path_from_a_tree_never_leaves_the_folder() {
    assert!(inside("src/a.rs").is_some());
    assert!(inside("../a.rs").is_none());
    assert!(inside("/etc/passwd").is_none());
    assert!(inside("").is_none());
}

#[test]
fn records_round_trip_and_old_ones_go() {
    let place = Place::new();
    let record = Record {
        run_id: "run-1".into(),
        account: "me".into(),
        conversation: "chat".into(),
        folder: place.folder().to_string_lossy().into_owned(),
        before: Some(place.snap().to_string()),
        after: None,
        started_at: 100,
    };
    write_record(place.root.path(), &record).unwrap();
    assert_eq!(
        read_record(place.root.path(), "run-1"),
        Some(record.clone())
    );
    assert_eq!(record.turn().after, None);
    prune(place.root.path(), 50);
    assert!(read_record(place.root.path(), "run-1").is_some());
    assert_eq!(
        place.root.path().join("stores").read_dir().unwrap().count(),
        1
    );
    prune(place.root.path(), 200);
    assert!(read_record(place.root.path(), "run-1").is_none());
    assert_eq!(
        place.root.path().join("stores").read_dir().unwrap().count(),
        0
    );
}
