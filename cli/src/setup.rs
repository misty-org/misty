use crate::{
    environment::{self, Target},
    process::{npm, CommandSpec},
    workspace::Workspace,
};
use anyhow::{bail, Result};
use clap::{Args, ValueEnum};
#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum Component {
    All,
    Server,
    Desktop,
    Cloudflare,
}
#[derive(Debug, Args)]
pub struct Setup {
    #[arg(value_enum, default_value = "all")]
    pub component: Component,
    #[command(flatten)]
    cloudflare: crate::cloudflare::Options,
}
pub fn run(workspace: &Workspace, options: Setup) -> Result<()> {
    match options.component {
        Component::Cloudflare => crate::cloudflare::setup(workspace, options.cloudflare),
        Component::Desktop => desktop(workspace),
        Component::Server | Component::All => {
            environment::init(workspace, Target::Dev)?;
            crate::server::initialize_development_secrets(workspace)?;
            println!("Server configuration prepared. Existing values and keys were preserved.");
            if environment::validate(workspace, Target::Dev).is_err() {
                println!("Next: misty setup cloudflare --account ACCOUNT_ID --zone ZONE_ID --hostname api.example.com");
                println!("Then: misty server up; misty doctor server; misty setup desktop");
                return Ok(());
            }
            println!("Next: misty server up; misty doctor server");
            if matches!(options.component, Component::All) {
                environment::apply(workspace, Target::Dev)?;
                crate::server::health(workspace)?;
                desktop(workspace)?;
            }
            Ok(())
        }
    }
}

pub fn desktop(workspace: &Workspace) -> Result<()> {
    let path = workspace.misty.join(".env");
    if !path.exists() {
        let values = if environment::root(workspace, Target::Dev).exists() {
            environment::read(workspace, Target::Dev)?
        } else {
            Default::default()
        };
        let port = values
            .get("MISTY_HOST_PORT")
            .map(String::as_str)
            .unwrap_or("8081");
        let port: u16 = port.parse()?;
        crate::artifacts::write_private(
            &path,
            format!("MISTY_PUBLIC_API_URL=http://127.0.0.1:{port}/v1\n").as_bytes(),
        )?;
        println!("Created desktop API configuration in .env");
    }
    install_desktop_dependencies(workspace)
}

fn install_desktop_dependencies(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    let version = CommandSpec::new("node")
        .args(["--version"])
        .capture(&workspace.misty)?;
    let version = version.trim().trim_start_matches('v');
    let mut parts = version
        .split('.')
        .filter_map(|part| part.parse::<u32>().ok());
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    if major < 24 || (major == 24 && minor < 12) {
        bail!("Misty requires Node.js 24.12 or newer; found {version}");
    }
    CommandSpec::new(npm()).args(["ci"]).run(&workspace.misty)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    struct Command {
        #[command(flatten)]
        setup: Setup,
    }

    #[test]
    fn cloudflare_setup_is_development_only() {
        Command::try_parse_from(["setup", "cloudflare"]).unwrap();
        assert!(Command::try_parse_from(["setup", "cloudflare", "--target", "prod"]).is_err());
    }
}
