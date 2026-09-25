use crate::{
    environment,
    process::{command_exists, CommandSpec},
    workspace::Workspace,
};
use anyhow::{bail, Result};
use clap::{Args, ValueEnum};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Target {
    All,
    Server,
    Desktop,
    Cloudflare,
    Release,
}
#[derive(Debug, Args)]
pub struct Doctor {
    #[arg(value_enum, default_value = "all")]
    pub target: Target,
    #[arg(long)]
    pub json: bool,
    /// Create missing local environment files and secrets without overwriting values.
    #[arg(long)]
    pub fix: bool,
}
#[derive(Serialize)]
struct Finding {
    check: String,
    status: &'static str,
    detail: String,
    next: String,
}
fn record(findings: &mut Vec<Finding>, name: &str, result: Result<()>, next: &str) {
    let (status, detail) = match result {
        Ok(()) => ("ready", String::new()),
        Err(e) => ("needs attention", format!("{e}")),
    };
    findings.push(Finding {
        check: name.into(),
        status,
        detail,
        next: next.into(),
    });
}
pub fn run(workspace: &Workspace, options: Doctor) -> Result<()> {
    if options.fix {
        if options.json {
            bail!("run --fix separately from --json");
        }
        if !matches!(options.target, Target::All | Target::Server) {
            bail!("--fix supports server environment repairs only");
        }
        environment::init(workspace, environment::Target::Dev)?;
        crate::server::initialize_development_secrets(workspace)?;
    }
    let mut findings = Vec::new();
    record(
        &mut findings,
        "workspace",
        workspace.validate(),
        "Run from the Misty checkout",
    );
    if matches!(options.target, Target::All | Target::Server) {
        record(
            &mut findings,
            "Docker daemon",
            CommandSpec::new("docker")
                .args(["info", "--format", "{{.ServerVersion}}"])
                .capture(&workspace.misty)
                .map(|_| ()),
            "Start Docker Desktop or the Docker daemon",
        );
        record(
            &mut findings,
            "Docker Compose",
            CommandSpec::new("docker")
                .args(["compose", "version", "--short"])
                .capture(&workspace.misty)
                .and_then(|v| {
                    if !v.trim_start_matches('v').starts_with("2.") {
                        bail!("Docker Compose v2 required");
                    }
                    Ok(())
                }),
            "Install Docker Compose v2",
        );
        record(
            &mut findings,
            "server environment",
            environment::validate(workspace, environment::Target::Dev),
            "misty setup server; misty setup cloudflare",
        );
        record(
            &mut findings,
            "development keys",
            crate::server::validate_development_secrets(workspace),
            "misty setup server; restore matching key files if validation still fails",
        );
        record(
            &mut findings,
            "host ports",
            crate::server::ports(workspace),
            "Use misty env set dev MISTY_HOST_PORT to change the API port",
        );
        record(
            &mut findings,
            "containers",
            crate::server::health(workspace),
            "misty server up; misty server status",
        );
    }
    if matches!(options.target, Target::All | Target::Desktop) {
        for (name, args) in [
            ("node", vec!["--version"]),
            ("npm", vec!["--version"]),
            ("rustc", vec!["--version"]),
            ("cargo", vec!["--version"]),
        ] {
            record(
                &mut findings,
                name,
                CommandSpec::new(if name == "npm" {
                    crate::process::npm()
                } else {
                    name
                })
                .args(args)
                .capture(&workspace.misty)
                .and_then(|version| {
                    if name == "node" && !version_at_least(&version, 24, 12) {
                        bail!("Node 24.12 or newer required");
                    }
                    if name == "npm" && !version_at_least(&version, 11, 0) {
                        bail!("npm 11 or newer required");
                    }
                    Ok(())
                }),
                "Install the toolchain listed in README.md, then misty setup desktop",
            );
        }
        #[cfg(target_os = "macos")]
        record(
            &mut findings,
            "Xcode",
            CommandSpec::new("xcodebuild")
                .arg("-version")
                .capture(&workspace.misty)
                .map(|_| ()),
            "Install Xcode and select its developer directory",
        );
    }
    if options.target == Target::Cloudflare {
        record(
            &mut findings,
            "Cloudflare configuration",
            crate::cloudflare::check(workspace),
            "misty setup cloudflare",
        );
    }
    if options.target == Target::Cloudflare {
        record(
            &mut findings,
            "Worker deployment",
            crate::cloudflare::worker_health(workspace),
            "misty server deploy",
        );
        record(
            &mut findings,
            "public API health",
            crate::cloudflare::public_health(workspace),
            "misty server up; verify tunnel and DNS configuration",
        );
    }
    if !command_exists("docker") && options.target == Target::Cloudflare {
        record(
            &mut findings,
            "Docker",
            Err(anyhow::anyhow!("Docker is missing")),
            "Install Docker for Worker deployment",
        );
    }
    if options.json {
        println!("{}", serde_json::to_string_pretty(&findings)?);
    } else {
        for f in &findings {
            println!("{:<24} {}", f.check, f.status);
            if !f.detail.is_empty() {
                println!("  {}\n  Next: {}", f.detail, f.next);
            }
        }
    }
    if findings.iter().any(|f| f.status != "ready") {
        bail!("doctor found issues requiring attention");
    }
    Ok(())
}

fn version_at_least(version: &str, major: u32, minor: u32) -> bool {
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let found = (
        parts
            .next()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0),
        parts
            .next()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0),
    );
    found >= (major, minor)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_minimum_tool_versions() {
        assert!(!version_at_least("v24.11.9", 24, 12));
        assert!(version_at_least("v24.12.0", 24, 12));
        assert!(version_at_least("v25.0.0", 24, 12));
        assert!(!version_at_least("unknown", 24, 12));
    }
}
