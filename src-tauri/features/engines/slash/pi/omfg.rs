//! omp's `/omfg`: a rule forged from a complaint, in a fork of the session.

use super::*;

/// `--global` (the TUI's "Global — all projects" choice) and the complaint.
pub(super) fn omfg_args(args: &str) -> (bool, String) {
    let mut global = false;
    let words: Vec<&str> = args
        .split_whitespace()
        .filter(|word| {
            let flag = *word == "--global";
            global |= flag;
            !flag
        })
        .collect();
    (global, words.join(" "))
}

/// omp's `omfg-user.md`, with the failed attempts so far when there are any.
pub(super) fn omfg_prompt(complaint: &str, feedback: &[String], previous: Option<&str>) -> String {
    let mut text = String::from(OMFG_PROMPT_HEAD);
    text.push_str("\nComplaint:\n");
    text.push_str(complaint.trim());
    text.push('\n');
    if !feedback.is_empty() {
        text.push_str("\nFailed attempts or requested amendments so far:\n");
        text.push_str(&feedback.join("\n\n"));
        text.push_str("\n\nLatest candidate JSON:\n");
        text.push_str(previous.unwrap_or(""));
        text.push_str(
            "\n\nRegenerate one corrected rule. Fix the listed validation failures or user \
             amendment. NEVER repeat failed scopes or conditions.\n",
        );
    }
    text.push_str("</omfg>");
    text
}

const OMFG_PROMPT_HEAD: &str = r#"<omfg>
The user is frustrated about recurring agent behavior.
Author ONE Time Traveling Stream Rule (TTSR) that would have caught the offending behavior earlier in this conversation.

TTSR mechanics:
- A rule is a markdown file with YAML frontmatter.
- `condition` is one or more JavaScript regex patterns tested against assistant streamed output.
- `scope` is a comma-separated allowlist. If present, only listed streams are checked.
- `text` = assistant prose only. `thinking` = hidden reasoning summaries. `tool` = every tool's arguments.
- `tool:<name>(<glob>)` = one tool, only when path-like args match the glob. Examples: `tool:write(*.rb)`, `tool:edit(*.ts)`.
- SHOULD use file-specific tool scopes for code complaints. Ruby code generated through `write` → `tool:write(*.rb)`, not bare `tool` or `text`.
- Tool arguments may be serialized while streaming. Conditions for code containing quotes SHOULD tolerate JSON escaping.
- When `condition` matches within `scope`, the stream is interrupted and the markdown body is injected as correction guidance.

Output contract:
- Emit exactly one JSON object and nothing else.
- JSON fields: `name`, `description`, `condition`, `scope`, `body`.
- `name` MUST be kebab-case.
- `description` MUST be a one-line summary.
- `condition` MUST be a string or string array of JavaScript regex patterns.
- `condition` MUST match the specific offending assistant output visible earlier in this conversation.
- Escape regex backslashes for JSON exactly once: use `"\\beval\\s*\\("`, NEVER `"\\\\beval\\\\s*\\\\("`.
- Keep `condition` precise; NEVER use broad catch-alls.
- `scope` MUST be a string or string array.
- Keep `scope` as narrow as the complaint allows. NEVER use `tool, text` unless the same bad behavior occurred in both tool arguments and assistant prose.
- `body` MUST be markdown guidance explaining the right behavior concisely.
- The caller assembles YAML frontmatter. NEVER emit markdown frontmatter or a fenced code block around the JSON.

Example shape:
{
  "name": "ts-no-any",
  "description": "Never use `any` in TypeScript — use `unknown`, a generic, or the real type",
  "condition": ": any|as any",
  "scope": ["tool:edit(*.ts)", "tool:edit(*.tsx)", "tool:write(*.ts)", "tool:write(*.tsx)"],
  "body": "Never use `: any` or `as any`. Use `unknown`, a domain type, a generic, or a type guard."
}
"#;

/// A generated rule: its kebab-case name and the markdown file omp reads.
#[derive(Debug, PartialEq)]
pub(super) struct ForgedRule {
    pub(super) name: String,
    pub(super) file: String,
}

/// omp's `parseGeneratedRule` (`omfg-rule.ts`): the reply's JSON object, checked and assembled
/// into the rule file. omp also compiles each condition as a JavaScript regex; that check is
/// omp's own when it loads the rule.
pub(super) fn parse_rule(reply: &str) -> Result<ForgedRule, String> {
    let trimmed = reply.trim();
    let fenced = trimmed.find("```").and_then(|start| {
        let rest = &trimmed[start + 3..];
        let rest = rest.strip_prefix("json").unwrap_or(rest);
        rest.find("```")
            .and_then(|end| balanced_object(&rest[..end]))
    });
    let json_text = fenced
        .or_else(|| balanced_object(trimmed))
        .ok_or("Missing generated rule JSON object")?;
    let object: serde_json::Map<String, Value> = match serde_json::from_str(json_text) {
        Ok(Value::Object(object)) => object,
        Ok(_) => return Err("Generated rule JSON must be an object".into()),
        Err(error) => return Err(format!("Generated rule JSON is invalid: {error}")),
    };
    let field = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    let list = |key: &str| -> Option<Vec<String>> {
        let items: Vec<String> = match object.get(key)? {
            Value::String(text) => vec![text.trim().to_string()],
            Value::Array(values) => {
                let mut items: Vec<String> = Vec::new();
                for text in values.iter().filter_map(Value::as_str).map(str::trim) {
                    if !text.is_empty() && !items.iter().any(|item| item == text) {
                        items.push(text.to_string());
                    }
                }
                items
            }
            _ => return None,
        };
        Some(items).filter(|items| items.iter().any(|item| !item.is_empty()))
    };
    let raw_name = field("name").ok_or("Generated rule JSON must include a non-empty name")?;
    let description = field("description")
        .or_else(|| field("desc"))
        .ok_or("Generated rule JSON must include a non-empty description")?;
    let condition = list("condition")
        .or_else(|| list("cond"))
        .ok_or("Generated rule JSON must include at least one condition")?;
    let scope = list("scope").ok_or("Generated rule JSON must include at least one scope")?;
    let body = field("body").ok_or("Generated rule JSON must include a non-empty body")?;
    let name = rule_name(&raw_name);
    if name.is_empty() {
        return Err("Rule name must contain at least one letter or digit".into());
    }
    let quoted = |text: &str| Value::String(text.to_string()).to_string();
    let array = |values: &[String]| match values {
        [one] => quoted(one),
        _ => format!(
            "[{}]",
            values
                .iter()
                .map(|value| quoted(value))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    };
    let file = [
        "---".to_string(),
        format!("name: {name}"),
        format!("description: {}", quoted(&description)),
        format!("condition: {}", array(&condition)),
        format!("scope: {}", array(&scope)),
        "---".to_string(),
        String::new(),
        body.replace("\r\n", "\n").replace('\r', "\n"),
    ]
    .join("\n");
    Ok(ForgedRule { name, file })
}

/// The first `{…}` with its braces balanced, strings skipped.
pub(super) fn balanced_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let (mut depth, mut in_string, mut escaped) = (0usize, false, false);
    for (offset, char) in text[start..].char_indices() {
        if in_string {
            match char {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match char {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(&text[start..start + offset + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

/// omp's `sanitizeRuleName`: lowercase, quotes dropped, runs of anything else one dash.
pub(super) fn rule_name(raw: &str) -> String {
    let mut name = String::new();
    for char in raw.trim().to_lowercase().chars() {
        match char {
            '"' | '\'' | '`' => {}
            'a'..='z' | '0'..='9' | '_' | '-' => {
                if char == '-' && name.ends_with('-') {
                    continue;
                }
                name.push(char);
            }
            _ => {
                if !name.ends_with('-') {
                    name.push('-');
                }
            }
        }
    }
    name.trim_matches(|char| char == '-' || char == '_')
        .to_string()
}

/// omp's agent folder (`~/.omp/agent`, or the person's `PI_CODING_AGENT_DIR`, the only name omp
/// 18 reads for it), where its global rules are.
fn omp_agent_dir() -> PathBuf {
    let engine_env = crate::engine_config::engine_env::env_for("omp").unwrap_or_default();
    if let Some(dir) = engine_env
        .get("PI_CODING_AGENT_DIR")
        .cloned()
        .or_else(|| std::env::var("PI_CODING_AGENT_DIR").ok())
        .filter(|dir| !dir.trim().is_empty())
    {
        return PathBuf::from(dir);
    }
    crate::engine_config::support::engine_home(None, ".omp").join("agent")
}

/// `/omfg [--global] <complaint>`: omp's rule forge. The model writes one TTSR rule in a
/// throwaway no-tools fork (up to three tries, each told why the last failed, as the TUI does)
/// and Misty saves it where omp loads rules: this project's `.omp/rules`, or with `--global`
/// the agent folder's `rules` (the TUI asks which). A rule already there isn't overwritten.
pub(super) async fn omfg(folder: &Path, session: &str, args: &str) -> Result<Output, String> {
    let (global, complaint) = omfg_args(args);
    let mut feedback: Vec<String> = Vec::new();
    let mut previous: Option<String> = None;
    let mut forged = None;
    for attempt in 1..=3 {
        let reply = side_reply(
            folder,
            session,
            &omfg_prompt(&complaint, &feedback, previous.as_deref()),
        )
        .await?;
        match parse_rule(&reply) {
            Ok(rule) => {
                forged = Some(rule);
                break;
            }
            Err(error) => {
                let failed = balanced_object(reply.trim())
                    .unwrap_or(reply.trim())
                    .to_string();
                feedback.push(format!(
                    "Attempt {attempt} failed: invalid rule ({error}).\nFailed candidate:\n{failed}"
                ));
                previous = Some(failed);
            }
        }
    }
    let rule = forged.ok_or("The model did not return a valid TTSR rule.")?;
    let dir = if global {
        omp_agent_dir().join("rules")
    } else {
        folder.join(".omp").join("rules")
    };
    let path = dir.join(format!("{}.md", rule.name));
    if tokio::fs::try_exists(&path).await.unwrap_or(false) {
        return Err(format!(
            "{} already exists. Remove it first to save the new rule.",
            path.display()
        ));
    }
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| format!("Couldn't create {}: {error}", dir.display()))?;
    tokio::fs::write(&path, &rule.file)
        .await
        .map_err(|error| format!("Couldn't write {}: {error}", path.display()))?;
    Ok(Output::info(
        "TTSR rule saved",
        vec![Section {
            heading: Some(path.display().to_string()),
            text: Some(format!("```markdown\n{}\n```", rule.file)),
            ..Section::default()
        }],
    ))
}
