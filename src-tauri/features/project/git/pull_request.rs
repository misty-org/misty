//! The open branch's pull request, for the session card's context sources: its number, title,
//! state, how its checks stand, and the issues it closes. Read through the person's own GitHub
//! CLI, so a missing, signed-out or slow `gh`, or a branch with no pull request, is simply none.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::folder_of;

/// The most closing issues the card names; each costs one more `gh` call.
const MOST_ISSUES: usize = 3;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPullRequest {
    pub number: u64,
    pub title: String,
    /// `OPEN`, `CLOSED` or `MERGED`, as GitHub says.
    pub state: String,
    pub url: String,
    pub draft: bool,
    /// `passing`, `failing` or `pending`; absent when the pull request has no checks.
    pub checks: Option<&'static str>,
    pub issues: Vec<LinkedIssue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedIssue {
    pub number: u64,
    pub title: Option<String>,
    /// `OPEN` or `CLOSED`; absent when `gh` could not say.
    pub state: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPr {
    number: u64,
    title: String,
    state: String,
    url: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    status_check_rollup: Vec<GhCheck>,
    #[serde(default)]
    closing_issues_references: Vec<GhIssueRef>,
}

/// A check run (`status`, `conclusion`) or a commit status (`state`).
#[derive(Debug, Deserialize)]
struct GhCheck {
    status: Option<String>,
    conclusion: Option<String>,
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhIssueRef {
    number: u64,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhIssue {
    title: Option<String>,
    state: Option<String>,
}

/// One summary for all of a pull request's checks: any failure fails it, then anything still
/// running keeps it pending.
fn checks_summary(checks: &[GhCheck]) -> Option<&'static str> {
    if checks.is_empty() {
        return None;
    }
    let upper = |value: &Option<String>| value.as_deref().unwrap_or("").to_ascii_uppercase();
    let failed = checks.iter().any(|check| {
        matches!(
            upper(&check.conclusion).as_str(),
            "FAILURE" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED" | "STARTUP_FAILURE"
        ) || matches!(upper(&check.state).as_str(), "FAILURE" | "ERROR")
    });
    if failed {
        return Some("failing");
    }
    let waiting = checks.iter().any(|check| {
        let status = upper(&check.status);
        (!status.is_empty() && status != "COMPLETED")
            || matches!(upper(&check.state).as_str(), "PENDING" | "EXPECTED")
    });
    Some(if waiting { "pending" } else { "passing" })
}

/// `gh` with its arguments in `folder`, under a hard deadline; its JSON output, or none.
async fn gh_json<T: for<'de> Deserialize<'de>>(folder: &Path, args: &[&str]) -> Option<T> {
    let program = crate::engines::resolve::find_program("gh")?;
    let mut command = crate::engines::resolve::command_for(&program);
    command
        .args(args)
        .current_dir(folder)
        .env("PATH", crate::engines::resolve::search_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    crate::engines::turn::own_group(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

/// The pull request for the branch checked out in a linked folder, or none.
#[tauri::command]
pub async fn project_branch_pull_request(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<Option<BranchPullRequest>, String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    let Some(pr) = gh_json::<GhPr>(
        &folder,
        &[
            "pr",
            "view",
            "--json",
            "number,title,state,url,isDraft,statusCheckRollup,closingIssuesReferences",
        ],
    )
    .await
    else {
        return Ok(None);
    };
    let mut issues = Vec::new();
    for reference in pr.closing_issues_references.iter().take(MOST_ISSUES) {
        let number = reference.number.to_string();
        let found = gh_json::<GhIssue>(
            &folder,
            &["issue", "view", &number, "--json", "title,state"],
        )
        .await;
        issues.push(LinkedIssue {
            number: reference.number,
            title: found.as_ref().and_then(|issue| issue.title.clone()),
            state: found.and_then(|issue| issue.state),
            url: reference.url.clone(),
        });
    }
    Ok(Some(BranchPullRequest {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.url,
        draft: pr.is_draft,
        checks: checks_summary(&pr.status_check_rollup),
        issues,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(status: &str, conclusion: Option<&str>) -> GhCheck {
        GhCheck {
            status: Some(status.into()),
            conclusion: conclusion.map(Into::into),
            state: None,
        }
    }

    #[test]
    fn sums_up_checks() {
        assert_eq!(checks_summary(&[]), None);
        assert_eq!(
            checks_summary(&[run("COMPLETED", Some("SUCCESS"))]),
            Some("passing")
        );
        assert_eq!(
            checks_summary(&[run("COMPLETED", Some("SUCCESS")), run("IN_PROGRESS", None)]),
            Some("pending")
        );
        assert_eq!(
            checks_summary(&[run("IN_PROGRESS", None), run("COMPLETED", Some("FAILURE"))]),
            Some("failing")
        );
        let status = GhCheck {
            status: None,
            conclusion: None,
            state: Some("PENDING".into()),
        };
        assert_eq!(checks_summary(&[status]), Some("pending"));
    }
}
