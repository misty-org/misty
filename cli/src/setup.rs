use crate::{
    environment::{self, Target},
    workspace::Workspace,
};
use anyhow::Result;
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
    component: Component,
    /// Apply the displayed Cloudflare resource plan.
    #[arg(long)]
    apply: bool,
    #[arg(long)]
    account: Option<String>,
    #[arg(long)]
    zone: Option<String>,
    #[arg(long)]
    hostname: Option<String>,
}
pub fn run(workspace: &Workspace, options: Setup) -> Result<()> {
    match options.component {
        Component::Cloudflare => crate::cloudflare::setup(
            workspace,
            options.account,
            options.zone,
            options.hostname,
            options.apply,
        ),
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
    crate::development::setup(workspace)
}
