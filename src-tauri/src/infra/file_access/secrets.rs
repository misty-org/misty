//! Files that hold secrets or run by themselves. They stay closed to agents even inside a shared
//! folder, because what an agent reads reaches the model and its web tools. The macOS shell profile
//! (`agent_shell/macos.rs`) says the same in its own rule language.
use std::path::{Component, Path};

pub fn is_secret_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || matches!(
            lower.as_str(),
            "id_rsa" | "id_dsa" | "id_ecdsa" | "id_ed25519" | "credentials" | ".netrc" | ".npmrc" | ".pypirc"
        )
        || [".pem", ".key", ".p12", ".pfx", ".keystore"]
            .iter()
            .any(|end| lower.ends_with(end))
}

pub fn is_secret_folder(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".ssh" | ".aws" | ".gnupg" | ".kube" | ".docker"
    )
}

/// Whether any part of a path inside a shared folder is closed to agents.
pub fn closed_to_agents(relative: &Path) -> bool {
    let parts: Vec<_> = relative
        .components()
        .filter_map(|part| match part {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect();
    let Some((file, folders)) = parts.split_last() else {
        return false;
    };
    is_secret_file(file)
        || is_secret_folder(file)
        || file.eq_ignore_ascii_case(".git")
        || folders
            .iter()
            .any(|folder| is_secret_folder(folder) || folder.eq_ignore_ascii_case(".git"))
}

#[cfg(test)]
mod tests {
    use super::closed_to_agents;
    use std::path::Path;

    #[test]
    fn closes_secrets_at_any_depth_and_in_any_case() {
        for path in [
            ".env",
            "app/.env.local",
            ".ENV",
            "id_rsa",
            "keys/SERVER.PEM",
            ".ssh/config",
            "a/.Aws/credentials",
            ".git/config",
            "repo/.git/hooks/pre-commit",
        ] {
            assert!(closed_to_agents(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn leaves_ordinary_files_alone() {
        for path in ["notes.md", "environment.txt", "docs/keys.txt", "gitignore", ".gitignore"] {
            assert!(!closed_to_agents(Path::new(path)), "{path}");
        }
    }
}
