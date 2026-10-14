mod common;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{fs, path::Path};

use common::{failed, fixture};
use misty_agent_code::git::{self, transfer};
use serde_json::{json, Value};

fn author() -> Value {
    json!({ "name": "Matt", "email": "88163196+kannachi323@users.noreply.github.com" })
}

fn init(root: &Path) {
    git::init(root).unwrap();
}

fn commit_all(root: &Path, message: &str) -> String {
    let result = git::commit(
        root,
        serde_json::from_value(json!({ "message": message, "author": author() })).unwrap(),
    )
    .unwrap();
    result["sha"].as_str().unwrap().to_owned()
}

#[test]
fn init_makes_a_repository_with_a_starter_gitignore() {
    let f = fixture();
    fs::write(f.root().join("index.html"), "<h1>hi</h1>").unwrap();
    init(&f.root());
    let status = git::status(&f.root()).unwrap();
    assert_eq!(status["branch"], "main");
    assert!(fs::read_to_string(f.root().join(".gitignore")).unwrap().contains(".env"));
    let paths: Vec<&str> = status["files"].as_array().unwrap().iter().map(|file| file["path"].as_str().unwrap()).collect();
    assert!(paths.contains(&"index.html"));
}

#[test]
fn commits_never_run_hooks_or_include_secrets() {
    let f = fixture();
    init(&f.root());
    let marker = f.outside.path().join("hook-ran");
    for hook in ["pre-commit", "commit-msg", "post-commit", "prepare-commit-msg"] {
        let path = f.root().join(".git/hooks").join(hook);
        fs::write(&path, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
        #[cfg(unix)]
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    // Remove the starter .gitignore so secrets aren't merely ignored.
    fs::remove_file(f.root().join(".gitignore")).unwrap();
    fs::write(f.root().join("index.html"), "<h1>hi</h1>").unwrap();
    fs::write(f.root().join(".env"), "API_KEY=live").unwrap();
    fs::write(f.root().join("server.pem"), "-----BEGIN-----").unwrap();
    let result = git::commit(
        &f.root(),
        serde_json::from_value(json!({ "message": "First page", "author": author() })).unwrap(),
    )
    .unwrap();
    assert!(!marker.exists(), "no hook ran");
    let refused: Vec<&str> = result["refused"].as_array().unwrap().iter().map(|item| item["path"].as_str().unwrap()).collect();
    assert!(refused.contains(&".env") && refused.contains(&"server.pem"), "{result}");
    let repo = git2::Repository::open(f.root()).unwrap();
    let tree = repo.head().unwrap().peel_to_tree().unwrap();
    assert!(tree.get_name("index.html").is_some());
    assert!(tree.get_name(".env").is_none());
    let commit = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(commit.author().email().unwrap(), "88163196+kannachi323@users.noreply.github.com");
}

#[test]
fn diffs_show_changes_but_never_secret_contents() {
    let f = fixture();
    init(&f.root());
    fs::remove_file(f.root().join(".gitignore")).unwrap();
    fs::write(f.root().join("index.html"), "one\ntwo\n").unwrap();
    commit_all(&f.root(), "start");
    // A secret committed outside Misty, then changed.
    let repo = git2::Repository::open(f.root()).unwrap();
    fs::write(f.root().join(".env"), "TOKEN=old-secret").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(".env")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("x", "x@example.com").unwrap();
    let parent = repo.head().unwrap().peel_to_commit().unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "secret\n", &tree, &[&parent]).unwrap();
    fs::write(f.root().join(".env"), "TOKEN=new-secret").unwrap();
    fs::write(f.root().join("index.html"), "one\n2\n").unwrap();
    let diff = serde_json::to_string(&git::diff(&f.root(), Default::default()).unwrap()).unwrap();
    assert!(diff.contains("index.html") && diff.contains("\"2\""), "{diff}");
    assert!(!diff.contains("secret"), "{diff}");
    let history = serde_json::to_string(
        &git::diff(&f.root(), serde_json::from_value(json!({ "commit": "HEAD" })).unwrap()).unwrap(),
    )
    .unwrap();
    assert!(!history.contains("old-secret"), "{history}");
}

#[test]
fn branches_switch_only_when_clean() {
    let f = fixture();
    init(&f.root());
    fs::write(f.root().join("a.txt"), "a").unwrap();
    commit_all(&f.root(), "a");
    let created = git::branch(&f.root(), serde_json::from_value(json!({ "name": "add-contact", "create": true })).unwrap()).unwrap();
    assert_eq!(created["branch"], "add-contact");
    fs::write(f.root().join("a.txt"), "changed").unwrap();
    assert!(git::branch(&f.root(), serde_json::from_value(json!({ "name": "main" })).unwrap()).is_err());
    for bad in ["-x", "a..b", "../main", "a b", "x.lock"] {
        assert!(git::branch(&f.root(), serde_json::from_value(json!({ "name": bad, "create": true })).unwrap()).is_err(), "{bad}");
    }
}

#[test]
fn a_repository_working_elsewhere_is_refused() {
    let f = fixture();
    init(&f.root());
    let repo = git2::Repository::open(f.root()).unwrap();
    repo.config().unwrap().set_str("core.worktree", &f.outside.path().display().to_string()).unwrap();
    assert!(git::status(&f.root()).is_err());
}

/// What GitHub's API reports for a commit: UTC times, trimmed message.
fn as_github(commit: &transfer::CommitData) -> transfer::CommitData {
    let utc = |person: &transfer::Person| transfer::Person {
        name: person.name.clone(),
        email: person.email.clone(),
        date: {
            let seconds = git::time::parse_iso(&person.date).unwrap();
            git::time::iso(seconds, 0).replace("+00:00", "Z")
        },
    };
    transfer::CommitData {
        author: utc(&commit.author),
        committer: utc(&commit.committer),
        message: commit.message.trim_end().to_owned(),
        ..commit.clone()
    }
}

fn mirror(from: &Path, to: &Path, remote_head: Option<&str>, depth_cut: Option<usize>) -> (Value, Vec<String>) {
    let plan = transfer::push_plan(from, remote_head).unwrap();
    let blobs: Vec<String> = plan.blobs.iter().map(|blob| blob.sha.clone()).collect();
    let contents = transfer::read_blobs(from, &blobs).unwrap();
    let mut commits: Vec<transfer::CommitData> = plan.commits.iter().map(as_github).collect();
    if let Some(keep) = depth_cut {
        commits = commits.split_off(commits.len() - keep);
    }
    let boundary = transfer::boundary(&commits, |sha| transfer::has_commit(to, sha));
    let objects = json!({
        "blobs": contents["blobs"],
        "trees": plan.trees,
        "commits": commits,
    });
    let written = transfer::write_objects(to, serde_json::from_value(objects).unwrap()).unwrap();
    assert_eq!(written["unmatched"], json!([]), "every commit rebuilt exactly");
    let state = transfer::update_branch(to, &plan.branch, &plan.head, &boundary).unwrap();
    (state, boundary)
}

#[test]
fn history_round_trips_through_githubs_description_with_identical_hashes() {
    let source = fixture();
    let target = fixture();
    init(&source.root());
    fs::create_dir_all(source.root().join("css")).unwrap();
    fs::write(source.root().join("index.html"), "<h1>Hello</h1>\n").unwrap();
    fs::write(source.root().join("css/site.css"), "body{}\n").unwrap();
    fs::write(source.root().join("run.sh"), "#!/bin/sh\necho hi\n").unwrap();
    // Executable bits and file symlinks exist on unix only.
    #[cfg(unix)]
    {
        fs::set_permissions(source.root().join("run.sh"), fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink("index.html", source.root().join("home.html")).unwrap();
    }
    let first = commit_all(&source.root(), "First page");
    fs::write(source.root().join("index.html"), "<h1>Hello again</h1>\n").unwrap();
    let second = commit_all(&source.root(), "Second page\n\nWith a body.");
    git::set_origin(&source.root(), &git::GitHubRepo { owner: "kannachi323".into(), name: "site".into() }).unwrap();

    let github = git::GitHubRepo { owner: "kannachi323".into(), name: "site".into() };
    git::prepare_clone(&target.root(), &github, "main").unwrap();
    let (state, boundary) = mirror(&source.root(), &target.root(), None, None);
    assert_eq!(state["state"], "updated", "{state}");
    assert!(boundary.is_empty());
    let repo = git2::Repository::open(target.root()).unwrap();
    assert_eq!(repo.head().unwrap().peel_to_commit().unwrap().id().to_string(), second);
    assert_eq!(repo.find_commit(git2::Oid::from_str(&first).unwrap()).unwrap().summary().unwrap(), Some("First page"));
    // Checkout follows the person's core.autocrlf (on by default on Windows).
    let checked_out = fs::read_to_string(target.root().join("index.html")).unwrap();
    assert_eq!(checked_out.replace("\r\n", "\n"), "<h1>Hello again</h1>\n");
    #[cfg(unix)]
    {
        assert_eq!(fs::read_link(target.root().join("home.html")).unwrap(), Path::new("index.html"));
        assert_eq!(fs::metadata(target.root().join("run.sh")).unwrap().permissions().mode() & 0o111, 0o111);
    }

    // A later commit pushes only what's new, and fast-forwards the copy.
    fs::write(source.root().join("about.html"), "<p>About</p>\n").unwrap();
    let third = commit_all(&source.root(), "About page");
    let plan = transfer::push_plan(&source.root(), Some(&second)).unwrap();
    assert_eq!(plan.commits.len(), 1);
    assert_eq!(plan.blobs.len(), 1, "only the new file");
    let (state, _) = mirror(&source.root(), &target.root(), Some(&second), None);
    assert_eq!(state["state"], "updated");
    assert_eq!(git2::Repository::open(target.root()).unwrap().head().unwrap().peel_to_commit().unwrap().id().to_string(), third);
}

#[test]
fn commits_from_any_timezone_rebuild_exactly() {
    let f = fixture();
    init(&f.root());
    let repo = git2::Repository::open(f.root()).unwrap();
    fs::write(f.root().join("a.txt"), "a").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    // Kathmandu author, Chatham Islands committer, message with no newline.
    let author = git2::Signature::new("A", "a@example.com", &git2::Time::new(1_791_774_000, 345)).unwrap();
    let committer = git2::Signature::new("C", "c@example.com", &git2::Time::new(1_791_775_000, 765)).unwrap();
    let oid = repo.commit(Some("HEAD"), &author, &committer, "no newline", &tree, &[]).unwrap();
    git::set_origin(&f.root(), &git::GitHubRepo { owner: "o".into(), name: "r".into() }).unwrap();
    let plan = transfer::push_plan(&f.root(), None).unwrap();
    let rebuilt = transfer::rebuild_commit(&as_github(&plan.commits[0])).expect("rebuilt");
    assert_eq!(git2::Oid::hash_object(git2::ObjectType::Commit, &rebuilt).unwrap(), oid);
}

#[test]
fn shallow_fetches_and_diverged_pushes() {
    let source = fixture();
    let target = fixture();
    init(&source.root());
    for index in 0..4 {
        fs::write(source.root().join("log.txt"), format!("entry {index}\n")).unwrap();
        commit_all(&source.root(), &format!("Entry {index}"));
    }
    git::set_origin(&source.root(), &git::GitHubRepo { owner: "o".into(), name: "r".into() }).unwrap();
    git::prepare_clone(&target.root(), &git::GitHubRepo { owner: "o".into(), name: "r".into() }, "main").unwrap();
    let (state, boundary) = mirror(&source.root(), &target.root(), None, Some(2));
    assert_eq!(state["state"], "updated");
    assert_eq!(boundary.len(), 1, "the oldest fetched commit is the boundary");
    let log = git::log(&target.root(), serde_json::from_value(json!({})).unwrap()).unwrap();
    assert_eq!(log["commits"].as_array().unwrap().len(), 2, "{log}");

    // GitHub moved on while the project made its own commit: no push.
    fs::write(source.root().join("log.txt"), "remote\n").unwrap();
    let remote_only = commit_all(&source.root(), "Remote change");
    fs::write(target.root().join("log.txt"), "local\n").unwrap();
    commit_all(&target.root(), "Local change");
    assert!(transfer::push_plan(&target.root(), Some(&remote_only)).is_err());
}

#[test]
fn undo_takes_back_unpushed_commits_only() {
    let f = fixture();
    init(&f.root());
    fs::write(f.root().join("index.html"), "v1\n").unwrap();
    let start = commit_all(&f.root(), "v1");
    git::set_origin(&f.root(), &git::GitHubRepo { owner: "o".into(), name: "r".into() }).unwrap();

    let edit = |content: &str| json!({ "path": "index.html", "content": content });
    futures_block(f.service.execute(&f.project, "run_a", "code.write", edit("v2\n"))).unwrap();
    futures_block(f.service.execute(&f.project, "run_a", "git.commit", json!({ "message": "v2", "author": author() }))).unwrap();
    let undone = f.service.undo(&f.project, "run_a").unwrap();
    assert_eq!(undone["commitsRemoved"], 1, "{undone}");
    let repo = git2::Repository::open(f.root()).unwrap();
    assert_eq!(repo.head().unwrap().peel_to_commit().unwrap().id().to_string(), start);
    assert_eq!(fs::read_to_string(f.root().join("index.html")).unwrap(), "v1\n");
    assert!(git::status(&f.root()).unwrap()["clean"].as_bool().unwrap());

    // Once commits are on GitHub, undo restores files but keeps history.
    futures_block(f.service.execute(&f.project, "run_b", "code.write", edit("v3\n"))).unwrap();
    let pushed = futures_block(f.service.execute(&f.project, "run_b", "git.commit", json!({ "message": "v3", "author": author() }))).unwrap();
    transfer::record_push(&f.root(), "main", pushed["sha"].as_str().unwrap()).unwrap();
    let undone = f.service.undo(&f.project, "run_b").unwrap();
    assert_eq!(undone["commitsOnGitHub"], 1, "{undone}");
    assert_eq!(fs::read_to_string(f.root().join("index.html")).unwrap(), "v1\n");
}

#[test]
fn an_answers_diff_is_its_own_work() {
    let f = fixture();
    fs::write(f.root().join("index.html"), "<h1>Old</h1>\n").unwrap();
    futures_block(f.service.execute(&f.project, "run_1", "code.write", json!({ "path": "index.html", "content": "<h1>New</h1>\n" }))).unwrap();
    futures_block(f.service.execute(&f.project, "run_1", "code.write", json!({ "path": "about.html", "content": "<p>About</p>\n" }))).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    futures_block(f.service.execute(&f.project, "run_2", "code.write", json!({ "path": "contact.html", "content": "<p>Contact</p>\n" }))).unwrap();
    let first = f.service.run_diff(&f.project, "run_1").unwrap();
    let paths: Vec<&str> = first["files"].as_array().unwrap().iter().map(|file| file["path"].as_str().unwrap()).collect();
    assert_eq!(paths, vec!["about.html", "index.html"], "{first}");
    assert_eq!(first["additions"], 2);
    assert_eq!(first["deletions"], 1);
    let second = f.service.run_diff(&f.project, "run_2").unwrap();
    assert_eq!(second["files"][0]["path"], "contact.html");
    assert_eq!(second["files"][0]["status"], "added");
    assert!(failed(&misty_agent_code::outcome(f.service.run_diff(&f.project, "run_missing")).unwrap()));
}

fn futures_block<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap().block_on(future)
}
