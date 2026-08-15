use anyhow::Result;

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

pub fn dev(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    dev_command().run(&workspace.root)
}

fn dev_command() -> CommandSpec {
    CommandSpec::new(npm()).args(["run", "dev:website"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_uses_the_website_workspace_script() {
        let expected = if cfg!(windows) {
            "npm.cmd run dev:website"
        } else {
            "npm run dev:website"
        };
        assert_eq!(dev_command().display(), expected);
    }
}
