//! `/status` and `/usage`: the thread, the account, its rate limits and token use.

use super::*;

pub(super) async fn status(context: &Context) -> Result<Output, String> {
    let mut rpc = open(context).await?;
    let config = rpc
        .call("config/read", json!({ "cwd": folder(context) }))
        .await
        .map_err(text);
    let account = rpc.call("account/read", json!({})).await.map_err(text);
    let thread = match context.session.as_deref() {
        Some(thread) => rpc
            .call(
                "thread/read",
                json!({ "threadId": thread, "includeTurns": false }),
            )
            .await
            .ok(),
        None => None,
    };
    rpc.stop().await;
    let config = config?;
    let config = &config["config"];
    let mut sections = Vec::new();

    let mut chat = Vec::new();
    match context.session.as_deref() {
        Some(id) => chat.push(row("Thread", id)),
        None => chat.push(row("Thread", "None yet")),
    }
    if let Some(thread) = thread.as_ref() {
        if let Some(name) = text_at(thread, "/thread/name") {
            chat.push(row("Name", name));
        }
        if let Some(cwd) = text_at(thread, "/thread/cwd") {
            chat.push(row("Folder", cwd));
        }
    }
    sections.push(heading_rows("This chat", chat));

    let setting =
        |key: &str, fallback: &str| shown(&config[key]).unwrap_or_else(|| fallback.into());
    let approvals = match &config["approval_policy"] {
        Value::Object(_) => "granular".to_string(),
        other => shown(other).unwrap_or_else(|| "Codex default".into()),
    };
    sections.push(Section {
        heading: Some("Codex settings".into()),
        rows: vec![
            row("Model", setting("model", "Codex default")),
            row(
                "Reasoning effort",
                setting("model_reasoning_effort", "Codex default"),
            ),
            row("Sandbox", setting("sandbox_mode", "Codex default")),
            row("Approvals", approvals),
            row("Personality", setting("personality", "Codex default")),
            row("Service tier", setting("service_tier", "Codex default")),
            row("Provider", setting("model_provider", "OpenAI")),
        ],
        text: Some(
            "Codex's own settings. The model, effort and mode chosen in this chat win for its \
             turns."
                .into(),
        ),
    });

    // The email is shown to the person and never logged.
    let account_rows = match account {
        Ok(account) => account_rows(&account),
        Err(error) => vec![row("Account", error)],
    };
    sections.push(heading_rows("Account", account_rows));
    Ok(Output::info("Codex status", sections))
}

fn account_rows(read: &Value) -> Vec<Row> {
    let account = &read["account"];
    match account["type"].as_str() {
        Some("chatgpt") => {
            let mut rows = vec![row("Signed in", "ChatGPT")];
            if let Some(email) = text_at(account, "/email") {
                rows.push(row("Email", email));
            }
            if let Some(plan) = text_at(account, "/planType") {
                rows.push(row("Plan", title_case(plan)));
            }
            rows
        }
        Some("apiKey") => vec![row("Signed in", "API key")],
        Some("amazonBedrock") => vec![row("Signed in", "Amazon Bedrock")],
        _ if read["requiresOpenaiAuth"].as_bool() == Some(false) => {
            vec![row("Signed in", "Not needed for this provider")]
        }
        _ => vec![row("Signed in", "No")],
    }
}

pub(super) async fn usage(context: &Context) -> Result<Output, String> {
    let view = context.args.trim();
    if view == "reset" {
        return use_reset(context).await;
    }
    if !matches!(view, "" | "daily" | "weekly" | "cumulative") {
        return Err(
            "Use /usage, /usage daily, /usage weekly, /usage cumulative or /usage reset.".into(),
        );
    }
    let mut rpc = open(context).await?;
    let limits = rpc
        .call("account/rateLimits/read", Value::Null)
        .await
        .map_err(text);
    let tokens = rpc
        .call("account/usage/read", Value::Null)
        .await
        .map_err(text);
    rpc.stop().await;
    let mut sections = Vec::new();
    if view.is_empty() {
        sections.push(match &limits {
            Ok(limits) => limit_section(limits),
            Err(error) => text_section("Limits", error.clone()),
        });
    }
    sections.push(match &tokens {
        Ok(tokens) => token_section(tokens, view),
        Err(error) => text_section("Tokens", error.clone()),
    });
    Ok(Output::info("Codex usage", sections))
}

/// Uses one of the account's usage-limit resets. The key makes a retried request count once.
async fn use_reset(context: &Context) -> Result<Output, String> {
    let result = call_once(
        context,
        "account/rateLimitResetCredit/consume",
        json!({ "idempotencyKey": uuid::Uuid::new_v4().to_string() }),
    )
    .await?;
    let notice = match result["outcome"].as_str() {
        Some("reset") => "Your usage limit was reset.",
        Some("nothingToReset") => "Nothing to reset: you're within your limits.",
        Some("noCredit") => "You have no usage-limit resets left.",
        Some("alreadyRedeemed") => "That reset was already used.",
        _ => "Codex answered, but didn't say whether the limit was reset.",
    };
    Ok(Output::done(notice))
}

fn limit_section(limits: &Value) -> Section {
    let main = &limits["rateLimits"];
    let mut rows = Vec::new();
    window_rows(&mut rows, main, None);
    if let Some(buckets) = limits["rateLimitsByLimitId"].as_object() {
        let main_id = main["limitId"].as_str().unwrap_or("codex");
        let mut ids: Vec<&String> = buckets.keys().filter(|id| *id != main_id).collect();
        ids.sort();
        for id in ids {
            let bucket = &buckets[id];
            window_rows(
                &mut rows,
                bucket,
                Some(text_at(bucket, "/limitName").unwrap_or(id)),
            );
        }
    }
    if let Some(plan) = text_at(main, "/planType") {
        rows.push(row("Plan", title_case(plan)));
    }
    let credits = &main["credits"];
    if credits["unlimited"].as_bool() == Some(true) {
        rows.push(row("Credits", "Unlimited"));
    } else if credits["hasCredits"].as_bool() == Some(true) {
        if let Some(balance) = text_at(credits, "/balance") {
            rows.push(row("Credits", amount(balance)));
        }
    }
    let resets = limits["rateLimitResetCredits"]["availableCount"].as_i64();
    if let Some(resets) = resets {
        rows.push(row("Resets available", resets.to_string()));
    }
    Section {
        heading: Some("Limits".into()),
        rows,
        text: resets
            .filter(|count| *count > 0)
            .map(|_| "Use a reset with /usage reset.".into()),
    }
}

fn window_rows(rows: &mut Vec<Row>, snapshot: &Value, bucket: Option<&str>) {
    for slot in ["primary", "secondary"] {
        let window = &snapshot[slot];
        let Some(used) = window["usedPercent"].as_f64() else {
            continue;
        };
        let span = window["windowDurationMins"]
            .as_i64()
            .map(window_name)
            .unwrap_or_else(|| "Usage".into());
        let label = match bucket {
            Some(name) => format!("{name} · {span}"),
            None => span,
        };
        let mut value = format!("{}% used", used.round());
        if let Some(at) = window["resetsAt"].as_i64().and_then(local_time) {
            value.push_str(&format!(", resets {at}"));
        }
        rows.push(row(label, value));
    }
}

fn window_name(minutes: i64) -> String {
    match minutes {
        10_080 => "Weekly".into(),
        m if m > 0 && m % 1_440 == 0 => format!("{}-day", m / 1_440),
        m if m > 0 && m % 60 == 0 => format!("{}-hour", m / 60),
        m => format!("{m}-minute"),
    }
}

/// The account's tokens: the summary, or the days (`daily`), weeks (`weekly`) or running total
/// (`cumulative`) of the last ones Codex reports.
fn token_section(tokens: &Value, view: &str) -> Section {
    let days: Vec<(String, i64)> = tokens["dailyUsageBuckets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|bucket| {
            Some((
                bucket["startDate"].as_str()?.to_string(),
                bucket["tokens"].as_i64()?,
            ))
        })
        .collect();
    let rows = match view {
        "daily" => last(days.iter().map(|(day, used)| row(day, count(*used))), 14),
        "weekly" => last(weeks(&days).into_iter(), 8),
        "cumulative" => {
            let mut total: i64 = 0;
            let running = days.iter().map(|(day, used)| {
                total += *used;
                row(day, count(total))
            });
            last(running.collect::<Vec<_>>().into_iter(), 14)
        }
        _ => summary_rows(&tokens["summary"]),
    };
    let text = rows
        .is_empty()
        .then(|| "Codex reported no token use.".to_string());
    Section {
        heading: Some("Tokens".into()),
        rows,
        text,
    }
}

fn summary_rows(summary: &Value) -> Vec<Row> {
    let mut rows = Vec::new();
    if let Some(tokens) = summary["lifetimeTokens"].as_i64() {
        rows.push(row("All time", count(tokens)));
    }
    if let Some(tokens) = summary["peakDailyTokens"].as_i64() {
        rows.push(row("Busiest day", count(tokens)));
    }
    if let Some(days) = summary["currentStreakDays"].as_i64() {
        rows.push(row("Current streak", format!("{days} days")));
    }
    if let Some(days) = summary["longestStreakDays"].as_i64() {
        rows.push(row("Longest streak", format!("{days} days")));
    }
    if let Some(seconds) = summary["longestRunningTurnSec"].as_i64() {
        rows.push(row("Longest turn", duration(seconds)));
    }
    rows
}

/// Days summed into the weeks (Monday first) they fall in.
fn weeks(days: &[(String, i64)]) -> Vec<Row> {
    use chrono::Datelike;
    let mut weeks: Vec<(chrono::NaiveDate, i64)> = Vec::new();
    for (day, used) in days {
        let Ok(date) = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d") else {
            continue;
        };
        let monday = date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
        match weeks.iter().position(|(start, _)| *start == monday) {
            Some(at) => weeks[at].1 += *used,
            None => weeks.push((monday, *used)),
        }
    }
    weeks.sort_by_key(|(start, _)| *start);
    weeks
        .into_iter()
        .map(|(start, used)| row(format!("Week of {start}"), count(used)))
        .collect()
}

fn last(rows: impl Iterator<Item = Row>, keep: usize) -> Vec<Row> {
    let rows: Vec<Row> = rows.collect();
    let skip = rows.len().saturating_sub(keep);
    rows.into_iter().skip(skip).collect()
}
