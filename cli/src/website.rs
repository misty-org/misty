use anyhow::Result;

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

pub fn dev(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    dev_command().run(&workspace.website)
}

pub fn docs(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    docs_command().run(&workspace.website)
}

fn dev_command() -> CommandSpec {
    CommandSpec::new(npm()).args(["run", "dev"])
}

fn docs_command() -> CommandSpec {
    CommandSpec::new(npm()).args(["run", "dev:docs"])
}

pub fn docs_build(workspace: &Workspace) -> Result<()> {
    CommandSpec::new(npm())
        .args(["run", "build:docs"])
        .run(&workspace.website)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_uses_the_website_workspace_script() {
        let expected = if cfg!(windows) {
            "npm.cmd run dev"
        } else {
            "npm run dev"
        };
        assert_eq!(dev_command().display(), expected);
    }

    #[test]
    fn docs_uses_the_docs_workspace_script() {
        let expected = if cfg!(windows) {
            "npm.cmd run dev:docs"
        } else {
            "npm run dev:docs"
        };
        assert_eq!(docs_command().display(), expected);
    }
}
