use super::*;

pub(super) async fn agents(server: &Server) -> Result<Output, String> {
    let list = server.get(&server.path("/agent", "/api/agent")).await?;
    let visible: Vec<&Value> = data(&list)
        .as_array()
        .into_iter()
        .flatten()
        .filter(|agent| agent.get("hidden").and_then(Value::as_bool) != Some(true))
        .collect();
    let rows_of = |subagents: bool| -> Vec<Row> {
        visible
            .iter()
            .filter(|agent| (text_at(agent, "/mode") == Some("subagent")) == subagents)
            .map(|agent| {
                row(
                    text_at(agent, "/name").unwrap_or_default(),
                    text_at(agent, "/description").unwrap_or_default(),
                )
            })
            .collect()
    };
    let mut sections = Vec::new();
    for (heading, rows) in [("Agents", rows_of(false)), ("Subagents", rows_of(true))] {
        if !rows.is_empty() {
            sections.push(Section {
                heading: Some(heading.to_owned()),
                rows,
                text: None,
            });
        }
    }
    if sections.is_empty() {
        return Ok(Output::done("OpenCode lists no agents."));
    }
    Ok(Output::info("Agents", sections))
}

pub(super) async fn skills(server: &Server) -> Result<Output, String> {
    let list = server.get(&server.path("/skill", "/api/skill")).await?;
    let rows: Vec<Row> = data(&list)
        .as_array()
        .into_iter()
        .flatten()
        .map(|skill| {
            row(
                text_at(skill, "/id")
                    .or_else(|| text_at(skill, "/name"))
                    .unwrap_or_default(),
                text_at(skill, "/description").unwrap_or_default(),
            )
        })
        .collect();
    if rows.is_empty() {
        return Ok(Output::done("OpenCode found no skills."));
    }
    Ok(Output::info(
        "Skills",
        vec![Section {
            rows,
            text: Some("Type / and a skill's name to use it.".into()),
            ..Default::default()
        }],
    ))
}

pub(super) async fn org(server: &Server, wanted: &str) -> Result<Output, String> {
    let list = server.get("/experimental/console/orgs").await?;
    let orgs: Vec<&Value> = list
        .get("orgs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .collect();
    if orgs.is_empty() {
        return Ok(Output::done(
            "No OpenCode Console account is signed in here.",
        ));
    }
    if wanted.is_empty() {
        let rows = orgs
            .iter()
            .map(|org| {
                let email = text_at(org, "/accountEmail").unwrap_or_default();
                let value = if org.get("active").and_then(Value::as_bool) == Some(true) {
                    format!("{email}, current")
                } else {
                    email.to_owned()
                };
                row(text_at(org, "/orgName").unwrap_or_default(), value)
            })
            .collect();
        return Ok(Output::info(
            "Console orgs",
            vec![Section {
                rows,
                text: Some("/org <name> switches to one.".into()),
                ..Default::default()
            }],
        ));
    }
    let Some(target) = orgs.iter().find(|org| {
        text_at(org, "/orgName").is_some_and(|name| name.eq_ignore_ascii_case(wanted))
            || text_at(org, "/orgID") == Some(wanted)
    }) else {
        return Err(format!(
            "No Console org is called {wanted}. /org lists them."
        ));
    };
    server
        .call(
            Method::POST,
            "/experimental/console/switch",
            Some(json!({
                "accountID": target.get("accountID"),
                "orgID": target.get("orgID"),
            })),
        )
        .await?;
    Ok(Output::done(format!(
        "Switched to {}.",
        text_at(target, "/orgName").unwrap_or(wanted)
    )))
}
