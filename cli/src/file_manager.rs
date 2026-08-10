use anyhow::Result;

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

pub fn open(workspace: &Workspace) -> Result<()> {
    workspace.validate_file_manager()?;
    dev_command().run(&workspace.file_manager)
}

fn dev_command() -> CommandSpec {
    CommandSpec::new(npm()).args(["run", "tauri", "--", "dev"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_the_tauri_development_app() {
        let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
        assert_eq!(dev_command().display(), format!("{npm} run tauri -- dev"));
    }
}
