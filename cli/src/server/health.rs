//! Container status, readiness checks and host port checks.

use super::*;

pub fn status(workspace: &Workspace) -> Result<()> {
    let rows = container_status(workspace)?;
    println!("{:<27} STATUS", "SERVICE");
    for row in &rows {
        let service = row["Service"].as_str().unwrap_or("unknown");
        let state = row["State"].as_str().unwrap_or("unknown");
        let health = row["Health"].as_str().unwrap_or("");
        // Successful setup/deployment jobs are not ongoing server services.
        // Keep incomplete or failed jobs visible so their logs remain discoverable.
        let is_job = matches!(
            service,
            "setup"
                | "dev-init"
                | "migrate"
                | "database-permissions"
                | "agent-runtime-setup"
                | "cloudflare-deploy"
        );
        if is_job && state == "exited" && row["ExitCode"].as_i64() == Some(0) {
            continue;
        }
        let status = if !health.is_empty() { health } else { state };
        println!("{service:<27} {status}");
    }
    let billing = crate::billing::status(workspace).unwrap_or_default();
    for (service, status) in &billing {
        println!("{service:<27} {status}");
    }
    if rows.is_empty() && billing.is_empty() {
        println!("No containers started. Run misty server up.");
    }
    Ok(())
}

pub(super) fn container_status(workspace: &Workspace) -> Result<Vec<serde_json::Value>> {
    let output = development_compose()
        .args(["ps", "--all", "--format", "json"])
        .capture(&workspace.server)?;
    if output.trim().starts_with('[') {
        Ok(serde_json::from_str(&output)?)
    } else {
        Ok(output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(serde_json::from_str)
            .collect::<std::result::Result<_, _>>()?)
    }
}

pub fn ports(workspace: &Workspace) -> Result<()> {
    let values = environment::effective(workspace, Target::Dev)?;
    let rows = container_status(workspace).unwrap_or_default();
    for (key, fallback, service) in [
        ("MISTY_HOST_PORT", "8081", "misty-api"),
        ("DB_PORT", "5435", "postgres"),
    ] {
        let port: u16 = values
            .get(key)
            .map(String::as_str)
            .unwrap_or(fallback)
            .parse()
            .with_context(|| format!("{key} is not a valid port"))?;
        let owned = rows
            .iter()
            .filter(|row| row["Service"] == service && row["State"] == "running")
            .any(|row| {
                row["Publishers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|p| p["PublishedPort"].as_u64() == Some(port as u64))
            });
        if !owned {
            check_available_port(port)?;
        }
    }
    Ok(())
}
pub(super) fn check_available_port(port: u16) -> Result<()> {
    if port == 0 {
        bail!("host port must not be zero");
    }
    std::net::TcpListener::bind(("127.0.0.1", port)).with_context(|| format!("port {port} is occupied or unavailable; stop its owner or change the host port with misty env set"))?;
    Ok(())
}

pub fn health(workspace: &Workspace) -> Result<()> {
    let rows = container_status(workspace)?;
    validate_health(&rows)
}
pub(super) fn validate_health(rows: &[serde_json::Value]) -> Result<()> {
    for service in ["postgres", "agent-runtime", "misty-api", "tunnel"] {
        let row = rows
            .iter()
            .find(|row| row["Service"] == service)
            .with_context(|| format!("{service} has not started"))?;
        if row["State"] != "running" || row["Health"] != "healthy" {
            bail!("{service} is not healthy");
        }
    }
    for row in rows {
        if row["Service"] == "cloudflare-deploy" {
            continue;
        }
        if row["State"] == "exited" && row["ExitCode"].as_i64().unwrap_or(0) != 0 {
            bail!("{} failed; inspect its service logs", row["Service"]);
        }
        if row["State"] == "restarting" || row["Health"] == "unhealthy" {
            bail!("{} is unhealthy", row["Service"]);
        }
    }
    Ok(())
}
