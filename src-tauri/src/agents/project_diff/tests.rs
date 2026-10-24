use super::*;

#[test]
fn parses_modified_added_and_renamed_files() {
    let text = "diff --git a/src/a.rs b/src/a.rs\nindex 1..2 100644\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -1,3 +1,3 @@\n fn a() {\n-    old();\n+    new();\n }\ndiff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\ndiff --git a/old.md b/doc.md\nsimilarity index 100%\nrename from old.md\nrename to doc.md\n";
    let set = parse(text);
    assert_eq!(set.files.len(), 3);
    assert_eq!((set.additions, set.deletions), (2, 1));
    let first = &set.files[0];
    assert_eq!(
        (first.path.as_str(), first.status),
        ("src/a.rs", "modified")
    );
    assert_eq!(
        first.hunks[0].lines[1],
        DiffLine {
            kind: "del",
            text: "    old();".into(),
            old: Some(2),
            new: None
        }
    );
    assert_eq!(
        first.hunks[0].lines[2],
        DiffLine {
            kind: "add",
            text: "    new();".into(),
            old: None,
            new: Some(2)
        }
    );
    assert_eq!(set.files[1].status, "added");
    assert_eq!(
        (set.files[2].status, set.files[2].old_path.as_deref()),
        ("renamed", Some("old.md"))
    );
}

#[test]
fn reads_a_real_repository_without_changing_it() {
    let dir = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        assert!(Command::new("git")
            .args(args)
            .current_dir(dir.path())
            .output()
            .unwrap()
            .status
            .success())
    };
    run(&["init", "-q"]);
    std::fs::write(dir.path().join("a.txt"), "one\n").unwrap();
    run(&["add", "a.txt"]);
    run(&[
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.test",
        "commit",
        "-qm",
        "init",
    ]);
    std::fs::write(dir.path().join("a.txt"), "two\n").unwrap();
    std::fs::write(dir.path().join("b.txt"), "new\n").unwrap();
    let set = project_diff(dir.path()).unwrap();
    assert_eq!(
        set.files
            .iter()
            .map(|f| (f.path.as_str(), f.status))
            .collect::<Vec<_>>(),
        [("a.txt", "modified"), ("b.txt", "added")]
    );
    assert_eq!((set.additions, set.deletions), (2, 1));
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&status.stdout),
        " M a.txt\n?? b.txt\n",
        "the index is untouched"
    );
}
