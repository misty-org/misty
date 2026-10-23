//! The development Cloudflare tunnel and its public API URL.

use super::*;

pub fn url(workspace: &Workspace) -> Result<()> {
    println!("{}", ensure_active_development_api_url(workspace)?);
    Ok(())
}

const DEFAULT_DEVELOPMENT_API_TUNNEL_HOSTNAME: &str = "";

pub(super) fn development_tunnel_connection_command() -> CommandSpec {
    development_compose().args([
        "exec",
        "--no-TTY",
        "tunnel",
        "sh",
        "-c",
        "wget -q -O - http://127.0.0.1:20241/metrics | grep -Eq '^cloudflared_tunnel_ha_connections [1-9][0-9]*(\\.[0-9]+)?$'",
    ])
}

pub(super) fn development_tunnel_hostname() -> String {
    env::var("MISTY_DEV_API_TUNNEL_HOSTNAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_DEVELOPMENT_API_TUNNEL_HOSTNAME.to_owned())
}

pub(super) fn development_api_url() -> String {
    format!("https://{}/v1", development_tunnel_hostname())
}

pub(super) fn ensure_active_development_api_url(workspace: &Workspace) -> Result<String> {
    if development_tunnel_hostname().is_empty() {
        bail!("configure a hostname with misty setup cloudflare");
    }
    wait_for_development_tunnel(workspace)
}

pub(super) fn wait_for_development_tunnel(workspace: &Workspace) -> Result<String> {
    let started = Instant::now();
    let timeout = Duration::from_secs(30);
    let mut next_progress = Duration::from_secs(5);
    let url = development_api_url();
    loop {
        if development_tunnel_connection_command()
            .capture(&workspace.server)
            .is_ok()
            && development_tunnel_dns_is_published(workspace, &url).is_ok()
        {
            return Ok(url);
        }
        let elapsed = started.elapsed();
        if elapsed >= timeout {
            bail!("cloudflared did not establish a connection within 30 seconds");
        }
        if elapsed >= next_progress {
            eprintln!("Still waiting for Cloudflare... ({}s)", elapsed.as_secs());
            next_progress += Duration::from_secs(5);
        }
        thread::sleep(Duration::from_millis(500));
    }
}

pub(super) fn development_tunnel_dns_is_published(
    workspace: &Workspace,
    api_url: &str,
) -> Result<()> {
    let url = Url::parse(api_url).context("development API returned an invalid URL")?;
    let host = url
        .host_str()
        .context("development API URL has no hostname")?;
    let output = CommandSpec::new("dig")
        .args(["+short", "+time=1", "+tries=1", host, "A"])
        .capture(&workspace.server)
        .context("could not query the configured DNS resolver")?;
    if output
        .lines()
        .any(|line| line.trim().parse::<Ipv4Addr>().is_ok())
    {
        return Ok(());
    }
    bail!("Cloudflare DNS has not published the development tunnel yet")
}
