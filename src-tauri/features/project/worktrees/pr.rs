// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! A pull request's details from the GitHub CLI.

use super::*;

#[derive(Debug, Deserialize)]
pub(super) struct GhPrView {
    pub(super) title: Option<String>,
    pub(super) author: Option<GhPrAuthor>,
    pub(super) additions: Option<i64>,
    pub(super) deletions: Option<i64>,
    pub(super) state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhPrAuthor {
    pub(super) login: Option<String>,
}

/// `gh pr view` with a hard deadline: it may be missing, signed out or slow, and every one of
/// those only makes the preview plainer.
pub(super) async fn gh_pr_view(number: u64, repo_slug: &str) -> Option<GhPrView> {
    let program = crate::engines::resolve::find_program("gh")?;
    let mut command = crate::engines::resolve::command_for(&program);
    command
        .args([
            "pr",
            "view",
            &number.to_string(),
            "--repo",
            repo_slug,
            "--json",
            "title,author,additions,deletions,state",
        ])
        .env("PATH", crate::engines::resolve::search_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    crate::engines::turn::own_group(&mut command);
    let output = tokio::time::timeout(std::time::Duration::from_secs(3), command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}
