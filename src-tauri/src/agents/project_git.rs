//! Publishing a project to GitHub and cloning one from it, with the git on
//! this computer. GitHub creates the repository through the account the
//! person connected; git pushes and clones with the person's own git sign-in
//! (a credential helper, `gh auth login`, or SSH keys). Git never prompts:
//! a missing sign-in fails with a plain message instead of hanging.
use std::{path::Path, process::Command};

/// A GitHub repository's https address, or None for anything else.
pub fn github_https(url: &str) -> Option<String> {
    let rest = url.trim().strip_prefix("https://github.com/")?;
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, name) = rest.split_once('/')?;
    let valid = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    (valid(owner) && valid(name)).then(|| format!("https://github.com/{owner}/{name}.git"))
}

fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .output()
        .map_err(|_| "Git isn't installed on this computer.".to_owned())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    Err(plain_error(&String::from_utf8_lossy(&output.stderr)))
}

/// Git's complaint in plain words.
fn plain_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if [
        "authentication failed",
        "could not read username",
        "permission denied",
        "terminal prompts disabled",
        "403",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return "Git couldn't sign in to GitHub. Sign in with `gh auth login` (or your usual git sign-in), then try again.".into();
    }
    if lower.contains("please tell me who you are") || lower.contains("user.email") {
        return "Git needs your name and email first: run `git config --global user.name` and `user.email`, then try again.".into();
    }
    let line = stderr
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .unwrap_or("Git stopped with an error.");
    format!(
        "Git: {}",
        line.trim_start_matches("fatal: ")
            .chars()
            .take(200)
            .collect::<String>()
    )
}

/// Pushes a project to an empty repository and makes it the project's
/// `origin`. A folder that isn't a repository yet becomes one, and a
/// repository without commits gets one with everything in it.
pub fn publish(root: &Path, remote: &str) -> Result<(), String> {
    if git(root, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        git(root, &["init", "-q"])?;
    }
    if git(root, &["remote", "get-url", "origin"]).is_ok() {
        return Err("This project already has a remote named origin.".into());
    }
    if git(root, &["rev-parse", "-q", "--verify", "HEAD"]).is_err() {
        git(root, &["add", "-A"])?;
        git(root, &["commit", "-q", "-m", "First commit"])?;
    }
    git(root, &["remote", "add", "origin", remote])?;
    if let Err(error) = git(root, &["push", "-q", "-u", "origin", "HEAD"]) {
        let _ = git(root, &["remote", "remove", "origin"]);
        return Err(error);
    }
    Ok(())
}

/// Clones a repository into an empty folder.
pub fn clone_into(remote: &str, folder: &Path) -> Result<(), String> {
    let parent = folder.parent().ok_or("Choose a folder for the project.")?;
    let target = folder.to_string_lossy();
    git(parent, &["clone", "-q", "--", remote, &target]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn only_github_https_addresses_are_accepted() {
        assert_eq!(
            github_https("https://github.com/ana/site").as_deref(),
            Some("https://github.com/ana/site.git")
        );
        assert_eq!(
            github_https("https://github.com/ana/site.git").as_deref(),
            Some("https://github.com/ana/site.git")
        );
        for bad in [
            "http://github.com/a/b",
            "https://evil.com/a/b",
            "https://github.com/a/../b",
            "https://github.com/a",
            "ext::sh -c x",
        ] {
            assert_eq!(github_https(bad), None, "{bad}");
        }
    }

    #[test]
    fn publish_pushes_a_new_project_and_clone_brings_it_back() {
        let remote = tempfile::tempdir().unwrap();
        run(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("index.html"), "<h1>Hi</h1>\n").unwrap();
        run(project.path(), &["init", "-q", "-b", "main"]);
        run(project.path(), &["add", "-A"]);
        run(project.path(), &["commit", "-q", "-m", "start"]);
        let address = remote.path().to_string_lossy().into_owned();
        publish(project.path(), &address).unwrap();
        assert_eq!(
            publish(project.path(), &address).unwrap_err(),
            "This project already has a remote named origin."
        );
        let parent = tempfile::tempdir().unwrap();
        let folder = parent.path().join("copy");
        std::fs::create_dir(&folder).unwrap();
        clone_into(&address, &folder).unwrap();
        assert_eq!(
            std::fs::read_to_string(folder.join("index.html")).unwrap(),
            "<h1>Hi</h1>\n"
        );
    }

    #[test]
    fn a_failed_push_leaves_no_remote_behind() {
        let project = tempfile::tempdir().unwrap();
        run(project.path(), &["init", "-q"]);
        std::fs::write(project.path().join("a.txt"), "a").unwrap();
        run(project.path(), &["add", "-A"]);
        run(project.path(), &["commit", "-q", "-m", "a"]);
        let missing = project.path().join("no-such-remote");
        assert!(publish(project.path(), &missing.to_string_lossy())
            .unwrap_err()
            .starts_with("Git: "));
        assert!(git(project.path(), &["remote", "get-url", "origin"]).is_err());
    }
}
