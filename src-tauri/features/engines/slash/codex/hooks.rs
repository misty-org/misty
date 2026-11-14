//! `/hooks`: the hooks Codex runs for the chat's folder.

use super::*;

pub(super) async fn hooks(context: &Context) -> Result<Output, String> {
    let params = match folder(context) {
        Some(folder) => json!({ "cwds": [folder] }),
        None => json!({}),
    };
    let listed = call_once(context, "hooks/list", params).await?;
    let mut sections = Vec::new();
    for entry in listed["data"].as_array().into_iter().flatten() {
        let rows: Vec<Row> = entry["hooks"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|hook| {
                let what = text_at(hook, "/command")
                    .map(str::to_string)
                    .unwrap_or_else(|| hook["handlerType"].as_str().unwrap_or("hook").to_string());
                let mut value =
                    format!("{what} · {}", hook["source"].as_str().unwrap_or("unknown"));
                if hook["enabled"].as_bool() == Some(false) {
                    value.push_str(" · off");
                }
                if let Some(matcher) = text_at(hook, "/matcher") {
                    value.push_str(&format!(" · matches {matcher}"));
                }
                row(hook["eventName"].as_str().unwrap_or("hook"), value)
            })
            .collect();
        let problems: Vec<String> = entry["warnings"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|warning| warning.as_str().map(str::to_string))
            .chain(
                entry["errors"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|error| {
                        format!(
                            "{}: {}",
                            error["path"].as_str().unwrap_or_default(),
                            error["message"].as_str().unwrap_or_default()
                        )
                    }),
            )
            .map(|problem| format!("- {problem}"))
            .collect();
        if rows.is_empty() && problems.is_empty() {
            continue;
        }
        sections.push(Section {
            heading: text_at(entry, "/cwd").map(str::to_string),
            rows,
            text: (!problems.is_empty()).then(|| problems.join("\n")),
        });
    }
    if sections.is_empty() {
        return Ok(Output::done("Codex has no hooks set up."));
    }
    Ok(Output::info("Hooks", sections))
}
