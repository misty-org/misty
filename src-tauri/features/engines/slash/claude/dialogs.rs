//! Claude Code's terminal dialogs (`/status`, `/context`, `/memory`, `/hooks`, `/permissions`,
//! `/sandbox`, `/skills`, `/plan`), from its control answers.

use super::*;

pub(super) async fn status(context: &Context) -> Result<Output, String> {
    let answer = ask(context, json!({ "subtype": "get_status" })).await?;
    Ok(Output::info(
        "Status",
        status_sections(&answer, context.session.as_deref()),
    ))
}

pub(super) async fn context_usage(context: &Context) -> Result<Output, String> {
    let answer = ask(context, json!({ "subtype": "get_context_usage" })).await?;
    let used = answer
        .get("totalTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let most = answer.get("maxTokens").and_then(Value::as_u64).unwrap_or(0);
    let mut summary = vec![
        row("Model", field(&answer, "model")),
        row(
            "Tokens",
            format!(
                "{} / {} ({}%)",
                tokens(used),
                tokens(most),
                field(&answer, "percentage")
            ),
        ),
    ];
    if answer.get("isAutoCompactEnabled").and_then(Value::as_bool) == Some(true) {
        if let Some(at) = answer.get("autoCompactThreshold").and_then(Value::as_u64) {
            summary.push(row("Auto-compact", format!("At {}", tokens(at))));
        }
    } else {
        summary.push(row("Auto-compact", "Off"));
    }
    let categories = list(&answer, "categories")
        .iter()
        .map(|category| {
            let count = category.get("tokens").and_then(Value::as_u64).unwrap_or(0);
            let share = if most > 0 {
                format!(" ({:.1}%)", count as f64 * 100.0 / most as f64)
            } else {
                String::new()
            };
            let deferred = if field(category, "kind") == "deferred" {
                ", loaded when used"
            } else {
                ""
            };
            row(
                field(category, "name"),
                format!("{}{share}{deferred}", tokens(count)),
            )
        })
        .collect();
    Ok(Output::info(
        "Context",
        vec![
            Section {
                heading: None,
                rows: summary,
                text: None,
            },
            section("Estimated usage by category", categories),
        ],
    ))
}

pub(super) async fn memory(context: &Context) -> Result<Output, String> {
    let answer = ask(context, json!({ "subtype": "get_memory_dialog" })).await?;
    let files = list(&answer, "files")
        .iter()
        .map(|file| {
            let mut value = field(file, "path");
            if file.get("exists").and_then(Value::as_bool) == Some(false) {
                value.push_str(" (not created yet)");
            }
            row(field(file, "label"), value)
        })
        .chain(
            list(&answer, "folders")
                .iter()
                .map(|folder| row(field(folder, "label"), field(folder, "path"))),
        )
        .collect();
    let mut settings = vec![row(
        "Auto-memory",
        field(answer.get("auto_memory").unwrap_or(&Value::Null), "status"),
    )];
    if let Some(dream) = answer
        .get("auto_dream")
        .filter(|dream| dream.get("shown").and_then(Value::as_bool) == Some(true))
    {
        settings.push(row("Auto-dream", field(dream, "status")));
    }
    let mut sections = vec![section("Files", files), section("Settings", settings)];
    let memories: Vec<Row> = list(&answer, "memories")
        .iter()
        .map(|memory| {
            let about = field(memory, "description");
            row(
                field(memory, "name"),
                if about.is_empty() {
                    field(memory, "type")
                } else {
                    about
                },
            )
        })
        .collect();
    if !memories.is_empty() {
        sections.push(section("Memories", memories));
    }
    Ok(Output::info("Memory", sections))
}

pub(super) async fn hooks(context: &Context) -> Result<Output, String> {
    let answer = ask(context, json!({ "subtype": "get_hooks_listing" })).await?;
    let policy = answer.get("policy").unwrap_or(&Value::Null);
    let mut sections = Vec::new();
    if policy.get("allDisabled").and_then(Value::as_bool) == Some(true)
        || policy.get("disabledByPolicy").and_then(Value::as_bool) == Some(true)
    {
        sections.push(note(None, "Hooks are turned off."));
    }
    let hooks: Vec<Row> = list(&answer, "hooks")
        .iter()
        .map(|hook| {
            let matcher = field(hook, "matcher");
            let event = field(hook, "event");
            let label = if matcher.is_empty() {
                event
            } else {
                format!("{event} · {matcher}")
            };
            let mut value = field(hook, "displayText");
            let from = field(hook, "sourceLabel");
            if !from.is_empty() {
                value = format!("{value} ({from})");
            }
            row(label, value)
        })
        .collect();
    if hooks.is_empty() {
        sections.push(note(None, "No hooks are set up."));
    } else {
        sections.push(section("Hooks", hooks));
    }
    Ok(Output::info("Hooks", sections))
}

pub(super) async fn permissions(context: &Context) -> Result<Output, String> {
    let answer = ask(context, json!({ "subtype": "list_permission_rules" })).await?;
    let state = answer.get("state").unwrap_or(&Value::Null);
    let rules = list(state, "rules");
    let mut sections: Vec<Section> = [("allow", "Allow"), ("ask", "Ask"), ("deny", "Deny")]
        .into_iter()
        .filter_map(|(behavior, heading)| {
            let rows: Vec<Row> = rules
                .iter()
                .filter(|rule| field(rule, "behavior") == behavior)
                .map(|rule| row(field(rule, "rule"), source_name(&field(rule, "source"))))
                .collect();
            (!rows.is_empty()).then(|| section(heading, rows))
        })
        .collect();
    let folders: Vec<Row> = list(state, "workspaceDirectories")
        .iter()
        .map(|folder| match folder {
            Value::String(path) => row(path.clone(), ""),
            other => row(field(other, "path"), source_name(&field(other, "source"))),
        })
        .collect();
    if !folders.is_empty() {
        sections.push(section("Folders", folders));
    }
    if sections.is_empty() {
        sections.push(note(None, "No permission rules are set."));
    }
    Ok(Output::info("Permissions", sections))
}

pub(super) async fn sandbox(context: &Context) -> Result<Output, String> {
    let answer = ask(context, json!({ "subtype": "get_sandbox_dialog" })).await?;
    if answer.get("supported").and_then(Value::as_bool) == Some(false) {
        return Ok(Output::info(
            "Sandbox",
            vec![note(
                None,
                "Claude Code's sandbox isn't available on this computer.",
            )],
        ));
    }
    let joined = |value: &Value, key: &str| {
        list(value, key)
            .iter()
            .map(text)
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut rows = vec![
        row("Mode", field(&answer, "mode")),
        row("On in settings", field(&answer, "enabled_in_settings")),
        row(
            "Commands may run outside it",
            field(&answer, "unsandboxed_fallback"),
        ),
    ];
    if answer.get("locked").and_then(Value::as_bool) == Some(true) {
        rows.push(row("Set by policy", "Yes"));
    }
    let excluded = joined(&answer, "excluded_commands");
    if !excluded.is_empty() {
        rows.push(row("Excluded commands", excluded));
    }
    let restrictions = answer.get("restrictions").unwrap_or(&Value::Null);
    let limits: Vec<Row> = [
        ("fs_allow_read", "Can read"),
        ("fs_deny_read", "Can't read"),
        ("fs_allow_write", "Can write"),
        ("fs_deny_write", "Can't write"),
        ("network_allowed_domains", "Allowed domains"),
        ("network_denied_domains", "Blocked domains"),
        ("unix_sockets", "Unix sockets"),
    ]
    .into_iter()
    .map(|(key, label)| (label, joined(restrictions, key)))
    .filter(|(_, value)| !value.is_empty())
    .map(|(label, value)| row(label, value))
    .collect();
    let mut sections = vec![Section {
        heading: None,
        rows,
        text: None,
    }];
    if !limits.is_empty() {
        sections.push(section("Restrictions", limits));
    }
    let dependencies = answer.get("dependencies").unwrap_or(&Value::Null);
    let problems: Vec<String> = list(dependencies, "errors")
        .iter()
        .chain(list(dependencies, "warnings"))
        .map(text)
        .filter(|problem| !problem.is_empty())
        .collect();
    if !problems.is_empty() {
        sections.push(note(Some("Problems"), problems.join("\n")));
    }
    Ok(Output::info("Sandbox", sections))
}

pub(super) async fn skills(context: &Context) -> Result<Output, String> {
    let answer = ask(context, json!({ "subtype": "get_skills_dialog" })).await?;
    let (on, off): (Vec<&Value>, Vec<&Value>) = list(&answer, "skills")
        .iter()
        .partition(|skill| field(skill, "state") == "on");
    // Where each comes from and what it costs, as Claude Code's own dialog lists them: a
    // skill's description is written for the model and runs to a paragraph.
    let rows = |skills: Vec<&Value>| -> Vec<Row> {
        skills
            .into_iter()
            .map(|skill| {
                let name = field(skill, "display_name");
                let mut about = Vec::new();
                let source = field(skill, "source");
                if !source.is_empty() {
                    about.push(source);
                }
                if let Some(count) = skill.get("tokens").and_then(Value::as_u64) {
                    about.push(format!("~{} tokens", tokens(count)));
                }
                if about.is_empty() {
                    about.push(brief(&field(skill, "description")));
                }
                row(
                    if name.is_empty() {
                        field(skill, "name")
                    } else {
                        name
                    },
                    about.join(" · "),
                )
            })
            .collect()
    };
    let mut sections = Vec::new();
    if !on.is_empty() {
        sections.push(section("On", rows(on)));
    }
    if !off.is_empty() {
        sections.push(section("Off", rows(off)));
    }
    if sections.is_empty() {
        sections.push(note(None, "No skills are installed."));
    }
    Ok(Output::info("Skills", sections))
}

/// The session's plan. `/plan <description>` (turning plan mode on with a request) is the
/// composer's: Misty's modes are chosen in its mode menu.
pub(super) async fn plan(context: &Context) -> Result<Output, String> {
    let args = context.args.as_str();
    if !args.is_empty() && args != "open" {
        return Err("Choose Plan in the mode menu, then send your request.".into());
    }
    if context.session.is_none() {
        return Ok(Output::done("There's no plan in this chat yet."));
    }
    let answer = ask(context, json!({ "subtype": "get_plan" })).await?;
    let content = field(&answer, "content");
    if answer.get("exists").and_then(Value::as_bool) != Some(true) || content.trim().is_empty() {
        return Ok(Output::done("There's no plan in this chat yet."));
    }
    Ok(Output::info("Plan", vec![note(None, content)]))
}
