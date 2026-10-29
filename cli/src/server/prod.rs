//! Production Compose stack on this host.

use super::*;

pub(super) fn production_compose() -> CommandSpec {
    compose("compose.prod.yml")
}

pub fn production_check(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    production_compose()
        .args(["config", "--quiet"])
        .run(&workspace.server)
}

pub fn production_up(workspace: &Workspace) -> Result<()> {
    production_check(workspace)?;
    // Published images are pulled; without them the stack builds from this checkout.
    let published = environment::read(workspace, Target::Prod)?
        .get("MISTY_API_IMAGE")
        .is_some_and(|image| !image.trim().is_empty());
    if published {
        production_compose().arg("pull").run(&workspace.server)?;
        return production_compose()
            .args(["up", "--detach"])
            .run(&workspace.server);
    }
    production_compose()
        .args(["up", "--detach", "--build"])
        .run(&workspace.server)
}

pub fn production_down(workspace: &Workspace, volumes: bool) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    let mut command = production_compose().arg("down");
    if volumes {
        command = command.arg("--volumes");
    }
    command.arg("--remove-orphans").run(&workspace.server)
}

pub fn production_backup(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    CommandSpec::new("bash")
        .arg("scripts/prod-backup.sh")
        .run(&workspace.server)
}

pub fn production_restore(
    workspace: &Workspace,
    backup: &str,
    identity: &Path,
    confirmed: bool,
) -> Result<()> {
    if !confirmed {
        bail!("restore replaces production data; rerun with --yes");
    }
    environment::check(workspace, Target::Prod)?;
    let identity = identity
        .canonicalize()
        .with_context(|| format!("cannot read age identity {}", identity.display()))?;
    CommandSpec::new("bash")
        .arg("scripts/prod-restore.sh")
        .arg(backup)
        .arg(identity)
        .env("MISTY_RESTORE_CONFIRMED", "yes")
        .run(&workspace.server)
}

pub fn production_logs(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    production_compose()
        .args(["logs", "--follow"])
        .run(&workspace.server)
}
