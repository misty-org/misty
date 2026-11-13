// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! The network layer: GitHub requests with a 20-second timeout, 429/403 reported as rate limits.

use serde_json::Value;
use std::sync::Arc;

use super::core::*;
use super::fsutil::*;
// ===== Network: User-Agent, Accept and a 20s timeout; 429/403 → RateLimit =====

/// The hub's client: Misty's own, through the proxy from Settings.
pub(super) fn http_client() -> SkillResult<reqwest::Client> {
    crate::engine_config::support::http_client()
        .map_err(|e| SkillError::other(format!("Failed to build HTTP client: {e}")))
}

pub(super) fn rate_limit_error(status: reqwest::StatusCode) -> SkillError {
    let msg = format!(
        "GitHub rate-limited this request (HTTP {}). Try again later.",
        status.as_u16()
    );
    SkillError::RateLimited(msg)
}

pub(super) async fn fetch_checked(response: reqwest::Response) -> SkillResult<reqwest::Response> {
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status == reqwest::StatusCode::FORBIDDEN
    {
        return Err(rate_limit_error(status));
    }
    if !status.is_success() {
        return Err(SkillError::coded(
            "http",
            format!("HTTP {}", status.as_u16()),
        ));
    }
    Ok(response)
}

/// upstream fetchJson（Accept: application/vnd.github+json）。
pub(super) async fn fetch_json(client: &reqwest::Client, url: &str) -> SkillResult<Value> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|e| SkillError::coded("network", format!("request failed: {e}")))?;
    fetch_checked(response)
        .await?
        .json::<Value>()
        .await
        .map_err(|e| SkillError::coded("http", format!("invalid JSON response: {e}")))
}

/// upstream fetchText（Accept: text/plain）。
pub(super) async fn fetch_text(client: &reqwest::Client, url: &str) -> SkillResult<String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "text/plain")
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|e| SkillError::coded("network", format!("request failed: {e}")))?;
    fetch_checked(response)
        .await?
        .text()
        .await
        .map_err(|e| SkillError::coded("network", format!("failed to read response body: {e}")))
}

/// upstream getRepoTree: tries the branches [the configured branch (unless it matches /^head$/i), main,
/// master] once each; when all fail, the last error is returned.
pub(super) async fn get_repo_tree(
    client: &reqwest::Client,
    owner: &str,
    name: &str,
    branch: &str,
) -> SkillResult<(String, Vec<Value>)> {
    let mut branches: Vec<String> = Vec::new();
    if !branch.is_empty() && !eq_ignore_case(branch, "head") {
        branches.push(branch.to_string());
    }
    for fallback in [
        crate::known_names::DEFAULT_BRANCH,
        crate::known_names::OLD_DEFAULT_BRANCH,
    ] {
        if !branches.iter().any(|b| b == fallback) {
            branches.push(fallback.to_string());
        }
    }
    let mut last_error: Option<SkillError> = None;
    for candidate in &branches {
        let url = format!(
            "https://api.github.com/repos/{owner}/{name}/git/trees/{}?recursive=1",
            encode_uri_component(candidate)
        );
        match fetch_json(client, &url).await {
            Ok(data) => {
                if let Some(tree) = data.get("tree").and_then(Value::as_array) {
                    return Ok((candidate.clone(), tree.clone()));
                }
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| SkillError::other(format!("Unable to read {owner}/{name}"))))
}

/// upstream mapWithConcurrency: a worker pool of fixed size, results in input order.
/// (Upstream uses Promise.all, which rejects on the first rejection; this collects every result and lets
/// the caller decide, which is allSettled plus the caller surfacing the first error.)
pub(super) async fn map_with_concurrency<T, R, F, Fut>(
    items: Vec<T>,
    limit: usize,
    worker: F,
) -> Vec<Result<R, SkillError>>
where
    T: Send + 'static,
    R: Send + 'static,
    F: Fn(T) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Result<R, SkillError>> + Send + 'static,
{
    let count = items.len();
    let worker = Arc::new(worker);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(limit.max(1)));
    let mut set: tokio::task::JoinSet<(usize, Result<R, SkillError>)> = tokio::task::JoinSet::new();
    for (index, item) in items.into_iter().enumerate() {
        // Take a permit before spawning, like upstream's pool of N runners.
        let Ok(permit) = semaphore.clone().acquire_owned().await else {
            break;
        };
        let worker = Arc::clone(&worker);
        set.spawn(async move {
            let _permit = permit;
            let result = worker(item).await;
            (index, result)
        });
    }
    let mut results: Vec<Option<Result<R, SkillError>>> = Vec::new();
    results.resize_with(count, || None);
    while let Some(joined) = set.join_next().await {
        if let Ok((index, result)) = joined {
            results[index] = Some(result);
        }
    }
    results
        .into_iter()
        .map(|slot| slot.unwrap_or_else(|| Err(SkillError::other("concurrent worker failed"))))
        .collect::<Vec<_>>()
}
