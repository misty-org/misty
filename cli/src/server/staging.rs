//! Isolated staging Compose stack.

use super::*;

pub(super) fn staging_compose(workspace: &Workspace) -> Result<CommandSpec> {
    // Do not let exported production values leak into staging Compose
    // interpolation (for example AI credentials or database passwords).
    let mut command = compose("compose.prod.yml")
        .args(["--project-name", "misty-staging"])
        .env("MISTY_ENV_TARGET", "staging");
    for name in environment::registered_names() {
        command = command.env_remove(name);
    }
    for (name, value) in environment::read(workspace, Target::Staging)? {
        command = command.env(name, value);
    }
    Ok(command)
}

pub fn staging_check(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Staging)?;
    staging_compose(workspace)?
        .args(["config", "--quiet"])
        .run(&workspace.server)
}

pub fn staging_up(workspace: &Workspace) -> Result<()> {
    staging_check(workspace)?;
    staging_compose(workspace)?
        .args(["up", "--build", "--detach", "--remove-orphans"])
        .run(&workspace.server)?;
    let port = environment::effective(workspace, Target::Staging)?
        .get("MISTY_HOST_PORT")
        .cloned()
        .unwrap_or_else(|| "8082".into());
    println!("Staging API: http://127.0.0.1:{port}/v1");
    println!("For remote access, forward this loopback port over SSH.");
    Ok(())
}

pub fn staging_down(workspace: &Workspace, volumes: bool) -> Result<()> {
    environment::check(workspace, Target::Staging)?;
    let mut command = staging_compose(workspace)?.arg("down");
    if volumes {
        command = command.arg("--volumes");
    }
    command.args(["--remove-orphans"]).run(&workspace.server)
}

pub fn staging_status(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Staging)?;
    staging_compose(workspace)?
        .args(["ps", "--all"])
        .run(&workspace.server)
}

pub fn staging_logs(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Staging)?;
    staging_compose(workspace)?
        .args(["logs", "--follow"])
        .run(&workspace.server)
}
