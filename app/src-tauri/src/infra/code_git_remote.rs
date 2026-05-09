use std::{path::PathBuf, process::Command};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use super::code_git::{is_git_repo, run_git};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCloneRequest {
    destination: String,
    redeem_url: String,
    handoff: String,
}

impl Drop for GitCloneRequest {
    fn drop(&mut self) {
        self.handoff.zeroize();
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteRequest {
    root: String,
    redeem_url: String,
    handoff: String,
}

impl Drop for GitRemoteRequest {
    fn drop(&mut self) {
        self.handoff.zeroize();
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchRequest {
    root: String,
    name: String,
    start_point: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    root: String,
    message: String,
    stage_all: bool,
}

#[derive(Debug, Deserialize)]
struct GitCredentialExchange {
    clone_url: String,
    username: String,
    token: String,
}

impl Drop for GitCredentialExchange {
    fn drop(&mut self) {
        self.username.zeroize();
        self.token.zeroize();
    }
}

#[derive(Debug, Serialize)]
struct GitCredentialRedeemRequest<'a> {
    handoff: &'a str,
}

#[tauri::command]
pub async fn code_git_workspace_id(root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_workspace_id_blocking(root))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn code_git_clone(request: GitCloneRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_clone_blocking(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn code_git_fetch(request: GitRemoteRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_remote_blocking(request, RemoteOperation::Fetch)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn code_git_push(request: GitRemoteRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_remote_blocking(request, RemoteOperation::Push)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn code_git_create_branch(request: GitBranchRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_create_branch_blocking(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn code_git_commit(request: GitCommitRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_blocking(request))
        .await
        .map_err(|error| error.to_string())?
}

fn git_workspace_id_blocking(root: String) -> Result<String, String> {
    let canonical = PathBuf::from(root)
        .canonicalize()
        .map_err(|_| "The Code workspace folder is unavailable.".to_owned())?;
    if !canonical.is_dir() {
        return Err("The Code workspace root is not a folder.".to_owned());
    }
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    Ok(format!("local_{:x}", digest)[..30].to_owned())
}

fn git_clone_blocking(request: GitCloneRequest) -> Result<String, String> {
    let destination = PathBuf::from(request.destination.trim());
    if destination.exists() {
        return Err("Choose an empty destination for the clone.".to_owned());
    }
    let parent = destination
        .parent()
        .filter(|value| value.is_dir())
        .ok_or_else(|| "The clone destination parent is unavailable.".to_owned())?;
    let credential = exchange_credential(&request.redeem_url, &request.handoff)?;
    let destination_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Choose a valid clone destination.".to_owned())?;
    run_authenticated_git(
        parent,
        &["clone", "--", &credential.clone_url, destination_name],
        &credential,
    )
}

enum RemoteOperation {
    Fetch,
    Push,
}

fn git_remote_blocking(
    request: GitRemoteRequest,
    operation: RemoteOperation,
) -> Result<String, String> {
    let root = validated_repository(&request.root)?;
    let credential = exchange_credential(&request.redeem_url, &request.handoff)?;
    let origin = run_git(&root, &["remote", "get-url", "origin"])?;
    if !same_repository(origin.trim(), &credential.clone_url) {
        return Err("This folder's origin does not match the linked GitHub repository.".to_owned());
    }
    match operation {
        RemoteOperation::Fetch => {
            run_authenticated_git(&root, &["fetch", "--prune", "origin"], &credential)
        }
        RemoteOperation::Push => {
            let branch = run_git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
            let branch = branch.trim();
            if branch.is_empty() || branch == "HEAD" {
                return Err("Create or switch to a branch before pushing.".to_owned());
            }
            run_authenticated_git(
                &root,
                &[
                    "push",
                    "--set-upstream",
                    "origin",
                    &format!("HEAD:{branch}"),
                ],
                &credential,
            )
        }
    }
}

fn git_create_branch_blocking(request: GitBranchRequest) -> Result<String, String> {
    let root = validated_repository(&request.root)?;
    let name = request.name.trim();
    if name.is_empty() || name.len() > 240 {
        return Err("Enter a valid branch name.".to_owned());
    }
    run_git(&root, &["check-ref-format", "--branch", name])?;
    let start = request
        .start_point
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(start) = start {
        validate_start_point(start)?;
        let revision = format!("{start}^{{commit}}");
        let resolved = run_git(
            &root,
            &["rev-parse", "--verify", "--end-of-options", &revision],
        )?;
        return run_git(&root, &["switch", "-c", name, resolved.trim()]);
    }
    run_git(&root, &["switch", "-c", name])
}

fn validate_start_point(value: &str) -> Result<(), String> {
    if value.starts_with('-') || value.contains('\0') {
        return Err("Choose a valid branch starting point.".to_owned());
    }
    Ok(())
}

fn git_commit_blocking(request: GitCommitRequest) -> Result<String, String> {
    let root = validated_repository(&request.root)?;
    let message = request.message.trim();
    if message.is_empty() || message.len() > 10_000 {
        return Err("Enter a commit message.".to_owned());
    }
    if request.stage_all {
        run_git(&root, &["add", "--all"])?;
    }
    run_git(&root, &["commit", "-m", message])
}

fn validated_repository(root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() || !is_git_repo(&root) {
        return Err("Open a Git repository in Code first.".to_owned());
    }
    Ok(root)
}

fn exchange_credential(redeem_url: &str, handoff: &str) -> Result<GitCredentialExchange, String> {
    let url = reqwest::Url::parse(redeem_url.trim())
        .map_err(|_| "The GitHub credential handoff is invalid.".to_owned())?;
    let local_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if (url.scheme() != "https" && !local_http)
        || !url.username().is_empty()
        || url.password().is_some()
        || !url
            .path()
            .ends_with("/native/github/credential-handoffs/redeem")
    {
        return Err("The GitHub credential handoff must use a secure server URL.".to_owned());
    }
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Misty could not prepare the GitHub credential exchange.".to_owned())?;
    let response = client
        .post(url)
        .header("Accept", "application/json")
        .json(&GitCredentialRedeemRequest { handoff })
        .send()
        .map_err(|_| "Misty could not exchange the one-time GitHub credential.".to_owned())?;
    if !response.status().is_success() {
        return Err("The one-time GitHub credential expired or was already used.".to_owned());
    }
    let credential = response
        .json::<GitCredentialExchange>()
        .map_err(|_| "The GitHub credential response was invalid.".to_owned())?;
    validate_credential(&credential)?;
    Ok(credential)
}

fn validate_credential(credential: &GitCredentialExchange) -> Result<(), String> {
    let clone_url = reqwest::Url::parse(credential.clone_url.trim())
        .map_err(|_| "The linked GitHub clone URL is invalid.".to_owned())?;
    if clone_url.scheme() != "https"
        || !clone_url.username().is_empty()
        || clone_url.password().is_some()
    {
        return Err("Misty only accepts credential-free HTTPS clone URLs from GitHub.".to_owned());
    }
    if credential.username.trim().is_empty() || credential.token.trim().is_empty() {
        return Err("The short-lived GitHub credential was empty.".to_owned());
    }
    Ok(())
}

fn run_authenticated_git(
    cwd: &std::path::Path,
    args: &[&str],
    credential: &GitCredentialExchange,
) -> Result<String, String> {
    let mut basic = BASE64.encode(format!("{}:{}", credential.username, credential.token));
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "http.extraHeader")
        .env(
            "GIT_CONFIG_VALUE_0",
            format!("Authorization: Basic {basic}"),
        )
        .output()
        .map_err(|error| error.to_string());
    basic.zeroize();
    let output = output?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn same_repository(left: &str, right: &str) -> bool {
    fn normalized(value: &str) -> Option<String> {
        let url = reqwest::Url::parse(value).ok()?;
        let host = url.host_str()?.to_ascii_lowercase();
        let path = url
            .path()
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .to_ascii_lowercase();
        Some(format!("{host}{path}"))
    }
    normalized(left) == normalized(right)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_equivalent_repository_urls() {
        assert!(same_repository(
            "https://github.com/Misty/demo.git\n",
            "https://github.com/misty/demo"
        ));
        assert!(!same_repository(
            "https://github.com/misty/other.git",
            "https://github.com/misty/demo.git"
        ));
    }

    #[test]
    fn rejects_credentials_embedded_in_clone_url() {
        let credential = GitCredentialExchange {
            clone_url: "https://token@github.com/misty/demo.git".to_owned(),
            username: "x-access-token".to_owned(),
            token: "short-lived".to_owned(),
        };
        assert!(validate_credential(&credential).is_err());
    }

    #[test]
    fn rejects_option_like_branch_start_points() {
        assert!(validate_start_point("--orphan").is_err());
        assert!(validate_start_point("origin/main").is_ok());
    }
}
