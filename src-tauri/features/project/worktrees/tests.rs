// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

use super::*;

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("misty-worktree-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(std::fs::canonicalize(&path).unwrap())
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn commit_file(repo: &git2::Repository, root: &Path, name: &str, content: &str) -> git2::Oid {
    std::fs::write(root.join(name), content).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(name)).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("test", "t@e.st").unwrap();
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, name, &tree, &parents)
        .unwrap()
}

/// A repository on `trunk` with one commit, in its own folder inside the scratch folder so
/// its worktrees folder lands in the scratch folder too.
fn init_repo(scratch: &Scratch) -> (PathBuf, git2::Repository) {
    let dir = scratch.join("repo");
    std::fs::create_dir_all(&dir).unwrap();
    let mut options = git2::RepositoryInitOptions::new();
    options.initial_head("trunk");
    let repo = git2::Repository::init_opts(&dir, &options).unwrap();
    commit_file(&repo, &dir, "init.txt", "one\n");
    (dir, repo)
}

fn create_args(branch: &str) -> WorktreeCreateArgs {
    WorktreeCreateArgs {
        space: String::new(),
        branch: branch.to_string(),
        base_ref: Some("trunk".to_string()),
        pr_number: None,
        existing_branch: false,
    }
}

fn quiet() -> impl Fn(CreateProgress) + Send + Sync {
    |_| {}
}

fn git_available() -> bool {
    crate::engines::resolve::find_program("git").is_some()
}

#[test]
fn pr_input_accepts_numbers_and_urls() {
    assert_eq!(parse_pr_input("1842"), Some(1842));
    assert_eq!(parse_pr_input(" #1842 "), Some(1842));
    assert_eq!(
        parse_pr_input("https://github.com/owner/repo/pull/1842"),
        Some(1842)
    );
    assert_eq!(
        parse_pr_input("https://github.com/owner/repo/pull/1842/files"),
        Some(1842)
    );
    assert_eq!(parse_pr_input("pulls"), None);
    assert_eq!(parse_pr_input("0"), None);
    assert_eq!(parse_pr_input(""), None);
    assert_eq!(
        parse_pr_input("https://github.com/owner/repo/issues/12"),
        None
    );
}

#[test]
fn owner_repo_parses_all_remote_shapes() {
    assert_eq!(
        github_owner_repo("https://github.com/owner/repo.git").as_deref(),
        Some("owner/repo")
    );
    assert_eq!(
        github_owner_repo("git@github.com:owner/repo.git").as_deref(),
        Some("owner/repo")
    );
    assert_eq!(
        github_owner_repo("ssh://git@github.com/owner/repo").as_deref(),
        Some("owner/repo")
    );
    assert_eq!(github_owner_repo("https://gitlab.com/owner/repo.git"), None);
    assert_eq!(github_owner_repo("https://github.com/owner"), None);
    assert_eq!(github_owner_repo("https://github.com/a/b/c"), None);
}

#[test]
fn porcelain_reads_main_branches_detached_locked_and_prunable() {
    let text = "worktree /repo\nHEAD aaa\nbranch refs/heads/trunk\n\n\
                    worktree /repo-worktrees/feat\nHEAD bbb\nbranch refs/heads/feat\nlocked busy\n\n\
                    worktree /repo-worktrees/old\nHEAD ccc\ndetached\nprunable gitdir file points to non-existent location\n";
    let list = parse_worktree_porcelain(text);
    assert_eq!(list.len(), 3);
    assert!(list[0].is_main);
    assert_eq!(list[0].branch.as_deref(), Some("trunk"));
    assert!(!list[1].is_main);
    assert!(list[1].locked);
    assert_eq!(list[1].lock_reason.as_deref(), Some("busy"));
    assert_eq!(list[2].branch, None);
    assert!(list[2].prunable);
    assert_eq!(list[2].head, "ccc");
}

#[test]
fn worktree_paths_sit_beside_the_repository() {
    let path = worktree_path(Path::new("/code/app"), "feature/x").unwrap();
    assert_eq!(path, PathBuf::from("/code/app-worktrees/feature-x"));
    assert_eq!(sanitize_dir_name("..hidden"), "hidden");
    assert_eq!(sanitize_dir_name("a//b"), "a-b");
    assert!(worktree_path(Path::new("/code/app"), "   ").is_err());
    assert!(worktree_path(Path::new("/code/app"), "..").is_err());
}

#[tokio::test]
async fn creates_a_new_branch_worktree_and_resumes_a_finished_one() {
    if !git_available() {
        return;
    }
    let scratch = Scratch::new();
    let (dir, _repo) = init_repo(&scratch);
    let cancel = CreationCancel::new();
    let report = quiet();
    let target = run_create(&report, "c1", &dir, &create_args("feat/one"), &cancel)
        .await
        .unwrap();
    assert_eq!(target, scratch.join("repo-worktrees/feat-one"));
    assert!(target.join("init.txt").is_file());
    let list = list_worktrees_cli(&dir).await.unwrap();
    assert!(list
        .iter()
        .any(|w| w.branch.as_deref() == Some("feat/one") && !w.is_main));
    // The branch exists now, so the same request is refused rather than resumed.
    let again = run_create(&report, "c2", &dir, &create_args("feat/one"), &cancel)
        .await
        .unwrap_err();
    assert_eq!(again.kind, "branch_exists");
    // Checking out the existing branch where it already lives resumes instead.
    let mut existing = create_args("feat/one");
    existing.existing_branch = true;
    let resumed = run_create(&report, "c3", &dir, &existing, &cancel).await;
    assert_eq!(resumed.unwrap_err().kind, "branch_checked_out");
}

#[tokio::test]
async fn refuses_a_taken_folder_a_bad_name_and_a_missing_base() {
    if !git_available() {
        return;
    }
    let scratch = Scratch::new();
    let (dir, _repo) = init_repo(&scratch);
    let cancel = CreationCancel::new();
    let report = quiet();
    std::fs::create_dir_all(scratch.join("repo-worktrees/taken")).unwrap();
    let taken = run_create(&report, "c", &dir, &create_args("taken"), &cancel)
        .await
        .unwrap_err();
    assert_eq!(taken.kind, "dir_exists");
    let bad = run_create(&report, "c", &dir, &create_args("bad name"), &cancel)
        .await
        .unwrap_err();
    assert_eq!(bad.kind, "invalid_branch");
    let mut no_base = create_args("fresh");
    no_base.base_ref = Some("nowhere".into());
    let missing = run_create(&report, "c", &dir, &no_base, &cancel)
        .await
        .unwrap_err();
    assert_eq!(missing.kind, "base_not_found");
}

#[tokio::test]
async fn a_cancelled_creation_stops_and_leaves_nothing() {
    if !git_available() {
        return;
    }
    let scratch = Scratch::new();
    let (dir, _repo) = init_repo(&scratch);
    let cancel = CreationCancel::new();
    cancel.cancel();
    let report = quiet();
    let stopped = run_create(&report, "c", &dir, &create_args("never"), &cancel)
        .await
        .unwrap_err();
    assert_eq!(stopped.kind, "canceled");
    assert!(!scratch.join("repo-worktrees/never").exists());
}

#[tokio::test]
async fn removes_a_worktree_with_its_branch_and_a_lost_one() {
    if !git_available() {
        return;
    }
    let scratch = Scratch::new();
    let (dir, _repo) = init_repo(&scratch);
    let cancel = CreationCancel::new();
    let report = quiet();
    let one = run_create(&report, "c", &dir, &create_args("one"), &cancel)
        .await
        .unwrap();
    let removed = remove_worktree(&dir, &one.to_string_lossy(), Some("one"), true)
        .await
        .unwrap();
    assert!(!removed.orphan_directory);
    assert!(removed.branch_deleted);
    assert!(!one.exists());

    // A worktree whose registration was pruned by hand is removed as a lost folder.
    let two = run_create(&report, "c", &dir, &create_args("two"), &cancel)
        .await
        .unwrap();
    std::fs::remove_dir_all(dir.join(".git/worktrees/two")).unwrap();
    let lost = remove_worktree(&dir, &two.to_string_lossy(), None, false)
        .await
        .unwrap();
    assert!(lost.orphan_directory);
    assert!(!two.exists());

    // An unrelated folder is never deleted.
    let plain = scratch.join("plain");
    std::fs::create_dir_all(plain.join("keep")).unwrap();
    assert!(remove_worktree(&dir, &plain.to_string_lossy(), None, false)
        .await
        .is_err());
    assert!(plain.join("keep").exists());
}

#[test]
fn merged_check_follows_the_commit_graph() {
    let scratch = Scratch::new();
    let (dir, repo) = init_repo(&scratch);
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("fresh", &head, false).unwrap();
    repo.branch("ahead", &head, false).unwrap();
    // A fresh branch on the base is merged.
    assert!(branch_merged(&dir, "fresh", "trunk").unwrap());
    // A commit only on `ahead` makes it unmerged; moving trunk to it merges it.
    repo.set_head("refs/heads/ahead").unwrap();
    let tip = commit_file(&repo, &dir, "more.txt", "two\n");
    assert!(!branch_merged(&dir, "ahead", "trunk").unwrap());
    repo.find_reference("refs/heads/trunk")
        .unwrap()
        .set_target(tip, "test")
        .unwrap();
    assert!(branch_merged(&dir, "ahead", "trunk").unwrap());
    assert!(branch_merged(&dir, "missing", "trunk").is_err());
}

#[test]
fn main_checkout_is_found_from_a_linked_worktree() {
    let scratch = Scratch::new();
    let (dir, repo) = init_repo(&scratch);
    let target = scratch.join("repo-worktrees/side");
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    let branch = repo.branch("side", &head, false).unwrap();
    let mut options = git2::WorktreeAddOptions::new();
    options.reference(Some(branch.get()));
    repo.worktree("side", &target, Some(&options)).unwrap();
    assert_eq!(main_checkout(&target).unwrap(), dir);
    assert_eq!(main_checkout(&dir).unwrap(), dir);
    let branches = list_branches(&repo);
    assert!(branches.iter().any(|b| b.name == "side" && !b.is_remote));
}
