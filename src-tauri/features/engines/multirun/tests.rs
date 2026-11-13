//! The pure pieces, the table, and the whole Git flow against a real repository in a temporary
//! folder: worktrees, a lane's changes, keeping one, refusing a clash, and taking it all down.
#![allow(clippy::disallowed_methods)] // Fixtures are built with the standard library.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::*;
use crate::project::git::{changes_since, run as git};

#[test]
fn only_an_id_made_here_names_a_multirun() {
    assert!(is_id(&new_id()));
    assert!(is_id("0a1b2c3d4e"));
    for wrong in [
        "",
        "0a1b2c3d4",
        "0A1B2C3D4E",
        "../../etc/x",
        "0a1b2c3d4e/",
        "-D0a1b2c3d",
    ] {
        assert!(!is_id(wrong), "{wrong}");
    }
    assert_eq!(branch_name("0a1b2c3d4e", 3), "misty/multirun-0a1b2c3d4e-3");
}

#[test]
fn only_a_full_commit_id_is_a_base() {
    assert!(is_commit(&"a1".repeat(20)));
    assert!(is_commit(&"0f".repeat(32)));
    for wrong in ["HEAD", "trunk", "--all", "a1b2c3", &"g1".repeat(20)] {
        assert!(!is_commit(wrong), "{wrong}");
    }
}

#[test]
fn ids_a_window_names_are_short_plain_text() {
    assert_eq!(plain("  agent_1 ").unwrap(), "agent_1");
    assert!(plain("").is_err());
    assert!(plain("a\nb").is_err());
    assert!(plain(&"x".repeat(201)).is_err());
}

fn row(multirun: &str, lane: i64, path: &str) -> Row {
    Row {
        account: "me".into(),
        multirun: multirun.into(),
        lane,
        space: "personal".into(),
        folder: "/work/app".into(),
        path: path.into(),
        branch: branch_name(multirun, lane),
        base: "a1".repeat(20),
        agent: format!("agent_{lane}"),
        conversation: format!("conversation_{multirun}_{lane}"),
        task: "Fix the bug".into(),
        kept: false,
        created_at: 7,
    }
}

#[test]
fn rows_group_into_multiruns_with_their_lanes_in_order() {
    let runs = grouped(vec![
        row("bbbbbbbbbb", 1, "/m/b/1"),
        row("bbbbbbbbbb", 2, "/m/b/2"),
        row("aaaaaaaaaa", 1, "/m/a/1"),
    ]);
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0].id, "bbbbbbbbbb");
    assert_eq!(
        runs[0]
            .lanes
            .iter()
            .map(|lane| lane.index)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(runs[0].lanes[1].folder, "/m/b/2");
    assert_eq!(runs[1].lanes[0].agent_id, "agent_1");
}

#[test]
fn a_clash_names_the_files_both_changed() {
    let set = |names: &[&str]| {
        names
            .iter()
            .map(|name| name.to_string())
            .collect::<HashSet<_>>()
    };
    assert!(worktrees::overlap(&set(&["a.rs"]), &set(&["b.rs"])).is_empty());
    let both = worktrees::overlap(&set(&["b.rs", "a.rs", "c.rs"]), &set(&["a.rs", "b.rs"]));
    assert_eq!(both, vec!["a.rs".to_string(), "b.rs".to_string()]);
    assert!(worktrees::overlap_message(&both).contains("a.rs, b.rs."));
    let many: Vec<String> = (0..7).map(|n| format!("f{n}")).collect();
    assert!(worktrees::overlap_message(&many).contains("f4 and 2 more."));
}

#[test]
fn a_turn_may_run_only_in_a_worktree_recorded_for_its_account() {
    let temp = tempfile::tempdir().unwrap();
    let db = database::store::Store::at(temp.path().join("misty.db"));
    store::insert(
        &db,
        &[
            row("aaaaaaaaaa", 1, "/m/a/1"),
            row("aaaaaaaaaa", 2, "/m/a/2"),
        ],
    )
    .unwrap();
    assert!(is_worktree(&db, "me", Path::new("/m/a/1")));
    // Not a folder inside it, the folder above it, another account, or the linked folder.
    assert!(!is_worktree(&db, "me", Path::new("/m/a/1/src")));
    assert!(!is_worktree(&db, "me", Path::new("/m/a")));
    assert!(!is_worktree(&db, "someone", Path::new("/m/a/1")));
    assert!(!is_worktree(&db, "me", Path::new("/work/app")));
    assert_eq!(worktree_folders(&db).len(), 2);

    store::mark_kept(&db, "me", "aaaaaaaaaa", 2).unwrap();
    let lanes = store::of_run(&db, "me", "aaaaaaaaaa").unwrap();
    assert_eq!(
        lanes.iter().map(|lane| lane.kept).collect::<Vec<_>>(),
        vec![false, true]
    );
    assert!(store::of_run(&db, "someone", "aaaaaaaaaa")
        .unwrap()
        .is_empty());
    assert_eq!(store::of_space(&db, "me", "personal").unwrap().len(), 2);

    store::delete(&db, "someone", "aaaaaaaaaa").unwrap();
    assert!(is_worktree(&db, "me", Path::new("/m/a/1")));
    store::delete(&db, "me", "aaaaaaaaaa").unwrap();
    assert!(!is_worktree(&db, "me", Path::new("/m/a/1")));
}

async fn ok(folder: &Path, arguments: &[&str]) -> String {
    git(folder, None, arguments)
        .await
        .unwrap_or_else(|error| panic!("git {arguments:?}: {error}"))
}

async fn repository(at: &Path) {
    fs::create_dir_all(at).unwrap();
    ok(at, &["init", "--quiet"]).await;
    ok(at, &["config", "user.name", "Tester"]).await;
    ok(at, &["config", "user.email", "tester@localhost"]).await;
    ok(at, &["config", "commit.gpgsign", "false"]).await;
}

fn paths(changes: &[crate::project::git::FileChange]) -> Vec<(&str, &str, u32, u32)> {
    changes
        .iter()
        .map(|file| {
            (
                file.path.as_str(),
                file.status,
                file.insertions,
                file.deletions,
            )
        })
        .collect()
}

#[tokio::test]
async fn a_multirun_goes_from_worktrees_to_one_kept_run_and_is_taken_down() {
    if crate::engines::resolve::find_program("git").is_none() {
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    let base_dir = temp.path().canonicalize().unwrap();
    let (repo, home) = (
        base_dir.join("repo"),
        base_dir.join("misty/multirun/0a1b2c3d4e"),
    );
    fs::create_dir_all(&home).unwrap();

    // What is in the way, one thing at a time.
    fs::create_dir_all(base_dir.join("plain")).unwrap();
    assert_eq!(
        worktrees::readiness(&base_dir.join("plain")).await.unwrap(),
        "not_repository"
    );
    repository(&repo).await;
    assert_eq!(worktrees::readiness(&repo).await.unwrap(), "no_commits");
    fs::create_dir_all(repo.join("src")).unwrap();
    fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();
    fs::write(repo.join("keep.txt"), "mine\n").unwrap();
    fs::write(repo.join("src/lib.rs"), "fn main() {}\n").unwrap();
    ok(&repo, &["add", "-A"]).await;
    ok(&repo, &["commit", "--quiet", "-m", "start"]).await;
    assert_eq!(worktrees::readiness(&repo).await.unwrap(), "ready");
    assert_eq!(
        worktrees::readiness(&repo.join("src")).await.unwrap(),
        "not_top_level"
    );

    // Three lanes from the same commit.
    let base = worktrees::head(&repo).await.unwrap();
    let lane =
        |n: i64| -> (PathBuf, String) { (home.join(n.to_string()), branch_name("0a1b2c3d4e", n)) };
    for n in 1..=3 {
        let (path, branch) = lane(n);
        worktrees::add(&repo, &path, &branch, &base).await.unwrap();
        assert!(path.join("a.txt").is_file());
    }
    let (one, two, three) = (lane(1).0, lane(2).0, lane(3).0);

    // Lane 1 leaves loose changes and a new file; lane 2 commits its own, as some agents do.
    fs::write(one.join("a.txt"), "one\nTWO\n").unwrap();
    fs::write(one.join("new.txt"), "hello\n").unwrap();
    fs::write(two.join("a.txt"), "one\ntwo, differently\n").unwrap();
    ok(
        &two,
        &["commit", "--quiet", "-am", "the agent's own commit"],
    )
    .await;
    fs::remove_file(two.join("src/lib.rs")).unwrap();

    let first = changes_since(&one, &one.with_extension("index"), &base)
        .await
        .unwrap();
    assert_eq!(
        paths(&first),
        vec![("a.txt", "modified", 1, 1), ("new.txt", "added", 1, 0)]
    );
    assert!(first[0].patch.contains("-two\n+TWO\n"));
    assert!(first[1].patch.contains("+hello"));
    // Reading a lane's changes leaves its own index alone: the new file is still untracked.
    assert!(ok(&one, &["status", "--porcelain"])
        .await
        .contains("?? new.txt"));
    assert!(home.join("1.index").is_file());
    let second = changes_since(&two, &two.with_extension("index"), &base)
        .await
        .unwrap();
    assert_eq!(
        paths(&second),
        vec![("a.txt", "modified", 1, 1), ("src/lib.rs", "deleted", 0, 1)]
    );
    let third = changes_since(&three, &three.with_extension("index"), &base)
        .await
        .unwrap();
    assert!(third.is_empty());

    // The person has a change of their own in the folder, in a file no lane touched.
    fs::write(repo.join("keep.txt"), "mine, edited\n").unwrap();

    // A lane that did nothing has nothing to keep.
    let nothing = worktrees::keep(&repo, &three, &base, "Multi-run, run 3")
        .await
        .unwrap_err();
    assert!(nothing.contains("changed nothing"), "{nothing}");

    // Uncommitted work in a file the lane also changed is a refusal that touches nothing.
    fs::write(repo.join("a.txt"), "one\ntwo\nthree\n").unwrap();
    let clash = worktrees::keep(&repo, &one, &base, "Multi-run, run 1")
        .await
        .unwrap_err();
    assert!(clash.contains("a.txt"), "{clash}");
    assert_eq!(
        fs::read_to_string(repo.join("a.txt")).unwrap(),
        "one\ntwo\nthree\n"
    );
    assert_eq!(ok(&repo, &["diff", "--cached", "--name-only"]).await, "");
    fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();

    // Keeping lane 1 stages its work in the folder and commits nothing there.
    worktrees::keep(&repo, &one, &base, "Multi-run, run 1")
        .await
        .unwrap();
    assert_eq!(
        ok(&repo, &["diff", "--cached", "--name-only"]).await,
        "a.txt\nnew.txt\n"
    );
    assert_eq!(worktrees::head(&repo).await.unwrap(), base);
    assert_eq!(
        fs::read_to_string(repo.join("a.txt")).unwrap(),
        "one\nTWO\n"
    );
    assert_eq!(
        fs::read_to_string(repo.join("keep.txt")).unwrap(),
        "mine, edited\n"
    );
    assert_eq!(ok(&repo, &["diff", "--name-only"]).await, "keep.txt\n");

    // With that still staged, a second keep is refused.
    let staged = worktrees::keep(&repo, &two, &base, "Multi-run, run 2")
        .await
        .unwrap_err();
    assert!(staged.contains("staged changes"), "{staged}");

    // Once the person commits it, lane 2 disagrees with the folder: refused, and backed out.
    ok(&repo, &["commit", "--quiet", "-m", "keep run 1"]).await;
    let moved = worktrees::head(&repo).await.unwrap();
    let conflict = worktrees::keep(&repo, &two, &base, "Multi-run, run 2")
        .await
        .unwrap_err();
    assert!(conflict.contains("conflict"), "{conflict}");
    assert_eq!(worktrees::head(&repo).await.unwrap(), moved);
    assert_eq!(ok(&repo, &["status", "--porcelain"]).await, " M keep.txt\n");
    assert_eq!(
        fs::read_to_string(repo.join("a.txt")).unwrap(),
        "one\nTWO\n"
    );
    assert!(repo.join("src/lib.rs").is_file());

    // Taking the multi-run down removes its worktrees and branches, and nothing else.
    let rows: Vec<Row> = (1..=3)
        .map(|n| Row {
            folder: repo.to_string_lossy().to_string(),
            ..row("0a1b2c3d4e", n, &lane(n).0.to_string_lossy())
        })
        .collect();
    take_down(&home, &rows).await;
    assert!(!home.exists());
    assert_eq!(
        ok(&repo, &["worktree", "list", "--porcelain"])
            .await
            .matches("worktree ")
            .count(),
        1
    );
    assert_eq!(ok(&repo, &["branch", "--list", "misty/*"]).await, "");
    assert_eq!(worktrees::head(&repo).await.unwrap(), moved);
    assert_eq!(
        fs::read_to_string(repo.join("keep.txt")).unwrap(),
        "mine, edited\n"
    );

    // A worktree recorded outside multi-run's own folder is never removed.
    let elsewhere = base_dir.join("elsewhere");
    worktrees::add(&repo, &elsewhere, "misty/multirun-0a1b2c3d4e-9", &moved)
        .await
        .unwrap();
    let stray = Row {
        folder: repo.to_string_lossy().to_string(),
        ..row("0a1b2c3d4e", 9, &elsewhere.to_string_lossy())
    };
    take_down(&home, &[stray]).await;
    assert!(elsewhere.join("a.txt").is_file());
}
