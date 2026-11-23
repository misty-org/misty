pub(crate) const INDEX: &str = "MEMORY.md";
pub(crate) const MOST_INDEX_LINES: usize = 200;
pub(crate) const MOST_INDEX_BYTES: usize = 25 * 1024;
pub(crate) const MOST_TOPIC_BYTES: usize = 64 * 1024;
const MOST_SLUG_CHARS: usize = 80;
const MOST_HOOK_CHARS: usize = 150;

pub(crate) fn slug(title: &str) -> String {
    let mut out = String::new();
    for character in title.trim().chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            out.push(character);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let cut: String = out.chars().take(MOST_SLUG_CHARS).collect();
    let cut = cut.trim_matches('-').to_string();
    match cut.as_str() {
        "" => "topic".into(),
        "memory" => "memory-notes".into(),
        _ => cut,
    }
}

pub(crate) fn index_entry(line: &str) -> Option<(String, String)> {
    let line = line.trim_start();
    let rest = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))?;
    let rest = rest.strip_prefix('[')?;
    let (title, rest) = rest.split_once("](")?;
    let (file, _) = rest.split_once(')')?;
    let file = file.trim();
    good_file(file).then(|| (title.trim().to_string(), file.to_string()))
}

pub(crate) fn good_file(file: &str) -> bool {
    !file.is_empty()
        && file.len() <= 200
        && !file.contains(['/', '\\', '\0'])
        && !file.starts_with('.')
        && file.to_ascii_lowercase().ends_with(".md")
        && !file.eq_ignore_ascii_case(INDEX)
}

pub(crate) fn topic_file(topic: &str, index: &str) -> Result<String, String> {
    let wanted = topic.trim();
    if wanted.is_empty() {
        return Err("Name the topic: its file name or its title.".into());
    }
    if wanted.eq_ignore_ascii_case(INDEX) {
        return Err("MEMORY.md is the index, and the memory tools keep it themselves.".into());
    }
    if wanted.contains(['/', '\\']) {
        return Err(format!(
            "{wanted:?} isn't a topic: give its file name, such as \"deploy-notes.md\", or its title."
        ));
    }
    let stem = strip_md(wanted);
    for line in index.lines() {
        let Some((title, file)) = index_entry(line) else {
            continue;
        };
        if title.eq_ignore_ascii_case(wanted)
            || file.eq_ignore_ascii_case(wanted)
            || strip_md(&file).eq_ignore_ascii_case(stem)
        {
            return Ok(file);
        }
    }
    Ok(format!("{}.md", slug(stem)))
}

fn strip_md(name: &str) -> &str {
    if name.to_ascii_lowercase().ends_with(".md") {
        &name[..name.len() - 3]
    } else {
        name
    }
}

pub(crate) fn hook_of(body: &str) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#') && *line != "---")
        .unwrap_or("");
    let line = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .unwrap_or(line);
    one_line(line, MOST_HOOK_CHARS)
}

pub(crate) fn one_line(text: &str, most: usize) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    joined
        .chars()
        .take(most)
        .collect::<String>()
        .trim()
        .to_string()
}

pub(crate) fn index_line(title: &str, file: &str, hook: &str) -> String {
    let title = one_line(&title.replace(['[', ']'], ""), 120);
    let hook = one_line(hook, MOST_HOOK_CHARS);
    if hook.is_empty() {
        format!("- [{title}]({file})")
    } else {
        format!("- [{title}]({file}) — {hook}")
    }
}

pub(crate) fn listed(index: &str, file: &str) -> bool {
    index
        .lines()
        .any(|line| index_entry(line).is_some_and(|(_, found)| found == file))
}

fn joined(lines: &[String]) -> String {
    if lines.iter().all(|line| line.trim().is_empty()) {
        return String::new();
    }
    format!("{}\n", lines.join("\n").trim_end())
}

pub(crate) fn with_line(index: &str, file: &str, line: &str) -> String {
    let mut lines: Vec<String> = index.lines().map(str::to_string).collect();
    match lines
        .iter()
        .position(|known| index_entry(known).is_some_and(|(_, found)| found == file))
    {
        Some(at) => lines[at] = line.to_string(),
        None => {
            while lines.last().is_some_and(|last| last.trim().is_empty()) {
                lines.pop();
            }
            lines.push(line.to_string());
        }
    }
    joined(&lines)
}

pub(crate) fn without_line(index: &str, file: &str) -> String {
    let lines: Vec<String> = index
        .lines()
        .filter(|line| index_entry(line).is_none_or(|(_, found)| found != file))
        .map(str::to_string)
        .collect();
    joined(&lines)
}

pub(crate) fn index_fits(index: &str) -> Result<(), String> {
    let lines = index.lines().count();
    if lines > MOST_INDEX_LINES || index.len() > MOST_INDEX_BYTES {
        return Err(format!(
            "MEMORY.md would be {lines} lines and {} KB, past its limit of {MOST_INDEX_LINES} lines \
or {} KB. Merge related topics or forget stale ones with memory_forget first. Nothing was saved.",
            index.len().div_ceil(1024),
            MOST_INDEX_BYTES / 1024,
        ));
    }
    Ok(())
}

pub(crate) fn topic_fits(text: &str) -> Result<(), String> {
    if text.len() > MOST_TOPIC_BYTES {
        return Err(format!(
            "That topic would be {} KB, past the limit of {} KB for one topic. Keep it shorter or \
split it into topics of their own. Nothing was saved.",
            text.len().div_ceil(1024),
            MOST_TOPIC_BYTES / 1024,
        ));
    }
    Ok(())
}

pub(crate) fn capped(index: &str) -> String {
    let mut out = String::new();
    for line in index.lines().take(MOST_INDEX_LINES) {
        if out.len() + line.len() + 1 > MOST_INDEX_BYTES {
            break;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim_end().to_string()
}

fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into())
}

pub(crate) struct Topic {
    pub(crate) front: Vec<String>,
    pub(crate) body: String,
}

pub(crate) fn split(text: &str) -> Topic {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return Topic {
            front: Vec::new(),
            body: text.trim().to_string(),
        };
    };
    let mut front = Vec::new();
    let mut lines = rest.split_inclusive('\n');
    let mut consumed = 0;
    let mut closed = false;
    for line in lines.by_ref() {
        consumed += line.len();
        let bare = line.trim_end_matches(['\n', '\r']);
        if bare == "---" {
            closed = true;
            break;
        }
        front.push(bare.to_string());
    }
    if !closed {
        return Topic {
            front: Vec::new(),
            body: text.trim().to_string(),
        };
    }
    Topic {
        front,
        body: rest[consumed..].trim().to_string(),
    }
}

fn value_of(front: &[String], key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    front.iter().find_map(|line| {
        let value = line.strip_prefix(&prefix)?.trim();
        if value.is_empty() {
            return None;
        }
        if value.starts_with('"') {
            if let Ok(text) = serde_json::from_str::<String>(value) {
                return Some(text);
            }
        }
        Some(value.trim_matches(['"', '\'']).to_string())
    })
}

pub(crate) fn title_of(front: &[String], file: &str) -> String {
    value_of(front, "title")
        .or_else(|| value_of(front, "name"))
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| strip_md(file).replace(['-', '_'], " "))
}

pub(crate) fn written(title: &str, updated: &str, by: &str, tags: &[String], body: &str) -> String {
    let mut text = format!(
        "---\ntitle: {}\nupdated: {updated}\nby: {}\n",
        quoted(title),
        quoted(by)
    );
    if !tags.is_empty() {
        let tags: Vec<String> = tags.iter().map(|tag| quoted(tag)).collect();
        text.push_str(&format!("tags: [{}]\n", tags.join(", ")));
    }
    text.push_str("---\n\n");
    text.push_str(body.trim());
    text.push('\n');
    text
}

pub(crate) fn restamped(topic: &Topic, file: &str, updated: &str, by: &str, body: &str) -> String {
    let mut front: Vec<String> = topic
        .front
        .iter()
        .filter(|line| !line.starts_with("updated:") && !line.starts_with("by:"))
        .cloned()
        .collect();
    if value_of(&front, "title").is_none() {
        front.insert(
            0,
            format!("title: {}", quoted(&title_of(&topic.front, file))),
        );
    }
    let at = front
        .iter()
        .position(|line| line.starts_with("title:"))
        .map_or(0, |at| at + 1);
    front.insert(at, format!("by: {}", quoted(by)));
    front.insert(at, format!("updated: {updated}"));
    format!("---\n{}\n---\n\n{}\n", front.join("\n"), body.trim())
}
