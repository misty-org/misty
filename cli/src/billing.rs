//! The billing service beside the server in local development. Billing lives in
//! its own private checkout (`misty-billing` next to `misty`) with its own
//! Compose project, database and credentials; `misty server up` brings it up
//! first, migrated and rebuilt, because the API meters every model turn through
//! it. Without the checkout the server still starts, and says so.

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::{process::CommandSpec, workspace::Workspace};

/// Billing's own credentials for local development (see its README).
const CREDENTIALS: &str = ".env/dev/database.env";

/// Variables billing's Compose file reads. The CLI loads the server's
/// environment into this process, and shell variables override `--env-file`,
/// so these are removed to let billing's own file decide.
const BILLING_VARIABLES: [&str; 8] = [
    "MISTY_BILLING_SECRET",
    "BILLING_OWNER_PASSWORD",
    "BILLING_RUNTIME_PASSWORD",
    "BILLING_POSTGRES_PORT",
    "BILLING_HOST_PORT",
    "COMPOSE_PROJECT_NAME",
    "COMPOSE_FILE",
    "COMPOSE_ENV_FILES",
];

/// The billing checkout when it is set up for local development.
fn checkout(workspace: &Workspace) -> Option<PathBuf> {
    let root = workspace.root.join("misty-billing");
    (root.join("compose.dev.yml").is_file() && root.join(CREDENTIALS).is_file()).then_some(root)
}

fn without_server_environment(mut command: CommandSpec) -> CommandSpec {
    for name in BILLING_VARIABLES {
        command = command.env_remove(name);
    }
    command
}

fn compose(root: &Path) -> CommandSpec {
    without_server_environment(CommandSpec::new("docker").args([
        "compose".into(),
        "--env-file".into(),
        root.join(CREDENTIALS).into_os_string(),
        "--file".into(),
        root.join("compose.dev.yml").into_os_string(),
    ]))
}

/// Starts billing's database, applies its migrations and runtime grants, then
/// rebuilds and starts the billing API and waits until it is healthy. Every step
/// is idempotent, so this runs on every `misty server up`.
pub fn up(workspace: &Workspace, log: &Path) -> Result<()> {
    let Some(root) = checkout(workspace) else {
        println!(
            "Billing: skipped; check out misty-billing beside misty with {CREDENTIALS} to meter usage locally."
        );
        return Ok(());
    };
    println!("Starting billing…");
    compose(&root)
        .args(["up", "--detach", "--wait", "postgres"])
        .run_logged(&root, log, &[])?;
    // The initializer applies migrations with the owner login and grants the
    // runtime login; it never enables the writer.
    without_server_environment(CommandSpec::new("python3").arg("deploy/local-development.py"))
        .run_logged(&root, log, &[])?;
    compose(&root)
        .args(["up", "--detach", "--build", "--wait", "billing"])
        .run_logged(&root, log, &[])
}

/// Stops billing. Its database volume is never removed from here: billing data
/// is only deleted on purpose, from its own checkout.
pub fn down(workspace: &Workspace) -> Result<()> {
    match checkout(workspace) {
        Some(root) => compose(&root).arg("down").run(&root),
        None => Ok(()),
    }
}

/// Billing's services and their health, for `misty server status`.
pub fn status(workspace: &Workspace) -> Result<Vec<(String, String)>> {
    let Some(root) = checkout(workspace) else {
        return Ok(Vec::new());
    };
    let output = compose(&root)
        .args(["ps", "--all", "--format", "json"])
        .capture(&root)?;
    let rows: Vec<serde_json::Value> = if output.trim().starts_with('[') {
        serde_json::from_str(&output)?
    } else {
        output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(serde_json::from_str)
            .collect::<std::result::Result<_, _>>()?
    };
    Ok(rows
        .iter()
        .map(|row| {
            let service = row["Service"].as_str().unwrap_or("unknown");
            let health = row["Health"].as_str().unwrap_or("");
            let state = row["State"].as_str().unwrap_or("unknown");
            let name = if service == "billing" {
                "billing".to_owned()
            } else {
                format!("billing-{service}")
            };
            let status = if health.is_empty() { state } else { health };
            (name, status.to_owned())
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn billing_commands_drop_server_values_that_would_override_its_credentials() {
        let shown = compose(Path::new("/work/misty-billing")).display();
        assert!(shown.contains("--env-file"));
        assert!(shown.contains("/work/misty-billing/.env/dev/database.env"));
        let removed = format!("{:?}", compose(Path::new("/w")));
        for name in BILLING_VARIABLES {
            assert!(removed.contains(name), "{name} is not removed");
        }
    }

    #[test]
    fn a_missing_checkout_or_credentials_file_skips_billing() {
        let root = std::env::temp_dir().join(format!("misty-billing-cli-{}", std::process::id()));
        let billing = root.join("misty-billing");
        std::fs::create_dir_all(billing.join(".env/dev")).unwrap();
        std::fs::write(billing.join("compose.dev.yml"), "").unwrap();
        let workspace = Workspace::from_root(root.clone()).unwrap();
        assert!(checkout(&workspace).is_none(), "credentials are missing");
        std::fs::write(billing.join(CREDENTIALS), "").unwrap();
        assert_eq!(checkout(&workspace), Some(billing));
        let _ = std::fs::remove_dir_all(root);
    }
}
