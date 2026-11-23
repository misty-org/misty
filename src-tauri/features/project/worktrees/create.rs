// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Making a worktree: check, fetch, add, with progress at each stage.

use super::*;

pub(super) type Report<'a> = &'a (dyn Fn(CreateProgress) + Send + Sync);

pub(super) fn progress(
    report: Report,
    creation_id: &str,
    stage: &'static str,
    message: Option<String>,
) {
    report(CreateProgress {
        creation_id: creation_id.to_string(),
        stage,
        message,
        error_kind: None,
        error: None,
        path: None,
    });
}

pub(super) async fn run_create(
    report: Report<'_>,
    creation_id: &str,
    repo_path: &Path,
    args: &WorktreeCreateArgs,
    cancel: &Arc<CreationCancel>,
) -> Result<PathBuf, CreateFailure> {
    let check_cancel = || {
        if cancel.is_cancelled() {
            Err(fail("canceled", String::new()))
        } else {
            Ok(())
        }
    };

    progress(report, creation_id, "validate", None);
    let branch = args.branch.trim().to_string();
    let target = worktree_path(repo_path, &branch).map_err(|e| fail("invalid_branch", e))?;
    let target_text = target.to_string_lossy().into_owned();
    let (fmt, _) = run_git(repo_path, &["check-ref-format", "--branch", &branch], None)
        .await
        .map_err(|e| fail("unknown", e))?;
    if !fmt.success || branch.starts_with('-') {
        return Err(fail(
            "invalid_branch",
            format!("{branch} isn't a valid branch name."),
        ));
    }
    let (branch_exists, remote_base) = {
        let repo = open_repo(repo_path).map_err(|error| {
            if error == NOT_A_REPO {
                fail("not_a_repo", error)
            } else {
                fail("repo_open_failed", error)
            }
        })?;
        let exists = repo.find_branch(&branch, git2::BranchType::Local).is_ok();
        let remote = args
            .base_ref
            .as_deref()
            .and_then(|base| split_remote(&repo, base))
            .map(|(remote, rest)| (remote.to_string(), rest.to_string()));
        (exists, remote)
    };
    if args.existing_branch && !branch_exists {
        return Err(fail(
            "branch_not_found",
            format!("There's no branch {branch}."),
        ));
    }
    if !args.existing_branch && branch_exists {
        return Err(fail(
            "branch_exists",
            format!("Branch {branch} already exists."),
        ));
    }

    let mut resume = false;
    if file_access::fs::exists(&target) {
        let list = list_worktrees_cli(repo_path)
            .await
            .map_err(|e| fail("unknown", e))?;
        resume = list.iter().any(|w| {
            same_path(&w.path, &target_text) && w.branch.as_deref() == Some(branch.as_str())
        });
        if !resume {
            return Err(fail("dir_exists", format!("{target_text} already exists.")));
        }
    }
    if args.existing_branch {
        let list = list_worktrees_cli(repo_path)
            .await
            .map_err(|e| fail("unknown", e))?;
        if list
            .iter()
            .any(|w| w.branch.as_deref() == Some(branch.as_str()))
        {
            return Err(fail(
                "branch_checked_out",
                format!("Branch {branch} is already checked out in another worktree."),
            ));
        }
    }
    check_cancel()?;

    if let Some(number) = args.pr_number.filter(|_| !resume) {
        progress(
            report,
            creation_id,
            "fetch",
            Some(format!("pull/{number}/head")),
        );
        let refspec = format!("+refs/pull/{number}/head:refs/heads/{branch}");
        let (out, cancelled) = run_git(repo_path, &["fetch", "origin", &refspec], Some(cancel))
            .await
            .map_err(|e| fail("unknown", e))?;
        if cancelled {
            return Err(fail("canceled", String::new()));
        }
        if !out.success {
            let kind = if out.stderr.contains("couldn't find remote ref") {
                "pr_not_found"
            } else {
                "fetch_failed"
            };
            return Err(fail(kind, summarize_stderr(&out.stderr)));
        }
    } else if !args.existing_branch && !resume {
        let base = args
            .base_ref
            .as_deref()
            .map(str::trim)
            .filter(|base| !base.is_empty() && !base.starts_with('-'))
            .ok_or_else(|| fail("invalid_args", "Choose a branch to start from."))?;
        if let Some((remote, rest)) = &remote_base {
            progress(report, creation_id, "fetch", Some(base.to_string()));
            let (_, cancelled) = run_git(repo_path, &["fetch", remote, rest], Some(cancel))
                .await
                .map_err(|e| fail("unknown", e))?;
            if cancelled {
                return Err(fail("canceled", String::new()));
            }
        }
        let (verify, _) = run_git(
            repo_path,
            &["rev-parse", "--verify", &format!("{base}^{{commit}}")],
            None,
        )
        .await
        .map_err(|e| fail("unknown", e))?;
        if !verify.success {
            return Err(fail(
                "base_not_found",
                format!("There's no branch {base} to start from."),
            ));
        }
    }
    check_cancel()?;

    if !resume {
        progress(report, creation_id, "add", Some(branch.clone()));
        let base = args.base_ref.as_deref().map(str::trim).unwrap_or("HEAD");
        let add_args: Vec<&str> = if args.existing_branch || args.pr_number.is_some() {
            vec!["worktree", "add", "--", &target_text, &branch]
        } else {
            vec![
                "worktree",
                "add",
                "--no-track",
                "-b",
                &branch,
                "--",
                &target_text,
                base,
            ]
        };
        let (out, cancelled) = run_git(repo_path, &add_args, Some(cancel))
            .await
            .map_err(|e| fail("unknown", e))?;
        if cancelled {
            cleanup_partial_add(repo_path, &target).await;
            return Err(fail("canceled", String::new()));
        }
        if !out.success {
            cleanup_partial_add(repo_path, &target).await;
            let kind = if out.stderr.contains("already checked out")
                || out.stderr.contains("already used by worktree")
            {
                "branch_checked_out"
            } else {
                "add_failed"
            };
            return Err(fail(kind, summarize_stderr(&out.stderr)));
        }
        ensure_push_auto_setup(repo_path).await;
    }

    if worktree_is_empty_checkout(&target) {
        if !resume {
            cleanup_partial_add(repo_path, &target).await;
        }
        return Err(fail(
            "sparse_checkout_empty",
            format!("{target_text} checked out no files: the repository's sparse-checkout rules leave out every path."),
        ));
    }
    check_cancel()?;
    Ok(target)
}

pub(super) fn reach_worktrees(repo: &Path) {
    if let Ok(root) = worktrees_root(repo) {
        file_access::allow_linked_folder(&root);
    }
}

pub(super) async fn linked_repository(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    account: &str,
    folder: &str,
) -> Result<PathBuf, String> {
    person_window(webview)?;
    let folder = linked_path(app, account, folder).await?;
    let repo = tokio::task::spawn_blocking(move || main_checkout(&folder))
        .await
        .map_err(|error| error.to_string())??;
    reach_worktrees(&repo);
    Ok(repo)
}
