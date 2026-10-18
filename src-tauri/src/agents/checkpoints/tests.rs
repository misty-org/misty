use std::{fs, path::Path, process::Command};

use super::Checkpoints;

fn git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&status.stderr)
    );
}

fn head(root: &Path) -> String {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(root)
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn project() -> (tempfile::TempDir, tempfile::TempDir) {
    let project = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let root = project.path();
    fs::write(root.join("a.txt"), "one\n").unwrap();
    fs::write(root.join("c.txt"), "gone soon\n").unwrap();
    fs::write(root.join(".gitignore"), "build/\n").unwrap();
    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["add", "."]);
    git(root, &["commit", "-q", "-m", "start"]);
    (project, data)
}

#[test]
fn undo_restores_files_and_rolls_back_local_commits() {
    let (project, data) = project();
    let root = project.path();
    let checkpoints = Checkpoints::new(data.path().to_path_buf());
    let start = head(root);
    checkpoints.ensure("scope_1", "run_1", root).unwrap();
    checkpoints.ensure("scope_1", "run_1", root).unwrap();

    fs::write(root.join("a.txt"), "two\n").unwrap();
    fs::create_dir_all(root.join("src/deep")).unwrap();
    fs::write(root.join("src/deep/new.rs"), "fn main() {}\n").unwrap();
    fs::remove_file(root.join("c.txt")).unwrap();
    fs::create_dir_all(root.join("build")).unwrap();
    fs::write(root.join("build/out.bin"), "ignored").unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "-q", "-m", "run"]);

    let diff = checkpoints.run_diff("scope_1", "run_1", root).unwrap();
    let statuses: Vec<(&str, &str)> = diff
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.status))
        .collect();
    assert_eq!(
        statuses,
        vec![
            ("a.txt", "modified"),
            ("c.txt", "deleted"),
            ("src/deep/new.rs", "added")
        ]
    );
    assert_eq!((diff.additions, diff.deletions), (2, 2));

    assert_eq!(checkpoints.list("scope_1").len(), 1);
    let result = checkpoints.undo("scope_1", "run_1", root).unwrap();
    assert_eq!(result["commitsRemoved"], 1);
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "one\n");
    assert_eq!(
        fs::read_to_string(root.join("c.txt")).unwrap(),
        "gone soon\n"
    );
    assert!(
        !root.join("src").exists(),
        "folders the run made go when empty"
    );
    assert!(
        root.join("build/out.bin").exists(),
        "ignored files are never touched"
    );
    assert_eq!(head(root), start);
    assert!(
        checkpoints.list("scope_1").is_empty(),
        "an undone run is forgotten"
    );
    assert!(checkpoints.undo("scope_1", "run_1", root).is_err());
}

#[test]
fn pushed_commits_stay_and_only_files_come_back() {
    let (project, data) = project();
    let root = project.path();
    let remote = tempfile::tempdir().unwrap();
    git(remote.path(), &["init", "-q", "--bare"]);
    git(
        root,
        &["remote", "add", "origin", &remote.path().to_string_lossy()],
    );
    git(root, &["push", "-q", "-u", "origin", "main"]);
    let checkpoints = Checkpoints::new(data.path().to_path_buf());
    checkpoints.ensure("scope_1", "run_2", root).unwrap();
    fs::write(root.join("a.txt"), "pushed\n").unwrap();
    git(root, &["commit", "-q", "-am", "run"]);
    git(root, &["push", "-q"]);
    let pushed = head(root);
    let result = checkpoints.undo("scope_1", "run_2", root).unwrap();
    assert_eq!(
        (
            result["commitsRemoved"].as_u64(),
            result["commitsPushed"].as_u64()
        ),
        (Some(0), Some(1))
    );
    assert_eq!(head(root), pushed);
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "one\n");
}

#[test]
fn plain_folders_skip_dependencies_and_diff_against_the_next_run() {
    let project = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let root = project.path();
    fs::write(root.join("notes.md"), "a\n").unwrap();
    fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    fs::write(root.join("node_modules/pkg/index.js"), "x").unwrap();
    let checkpoints = Checkpoints::new(data.path().to_path_buf());
    checkpoints.ensure("scope_2", "run_a", root).unwrap();
    fs::write(root.join("notes.md"), "b\n").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    checkpoints.ensure("scope_2", "run_b", root).unwrap();
    fs::write(root.join("notes.md"), "c\n").unwrap();
    fs::write(root.join("node_modules/pkg/index.js"), "changed").unwrap();
    let first = checkpoints.run_diff("scope_2", "run_a", root).unwrap();
    assert_eq!(first.files.len(), 1);
    assert_eq!(
        first.files[0].hunks[0]
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>(),
        vec!["a", "b"]
    );
    checkpoints.undo("scope_2", "run_a", root).unwrap();
    assert_eq!(fs::read_to_string(root.join("notes.md")).unwrap(), "a\n");
    assert_eq!(
        fs::read_to_string(root.join("node_modules/pkg/index.js")).unwrap(),
        "changed"
    );
    checkpoints.forget("scope_2");
    assert!(checkpoints.list("scope_2").is_empty());
    assert!(checkpoints.ensure("../escape", "run", root).is_err());
}

#[cfg(unix)]
#[test]
fn undo_never_writes_through_a_symlink_the_run_planted() {
    let (project, data) = project();
    let root = project.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.rs"), "lib\n").unwrap();
    let outside = tempfile::tempdir().unwrap();
    let checkpoints = Checkpoints::new(data.path().to_path_buf());
    checkpoints.ensure("scope_3", "run_x", root).unwrap();
    fs::remove_dir_all(root.join("src")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("src")).unwrap();
    checkpoints.undo("scope_3", "run_x", root).unwrap();
    assert!(fs::symlink_metadata(root.join("src")).unwrap().is_dir());
    assert_eq!(
        fs::read_to_string(root.join("src/lib.rs")).unwrap(),
        "lib\n"
    );
    assert!(
        fs::read_dir(outside.path()).unwrap().next().is_none(),
        "nothing lands outside the project"
    );
}
