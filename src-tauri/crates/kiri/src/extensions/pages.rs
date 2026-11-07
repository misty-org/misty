//! Loads the layer into an extension's HTML pages ahead of their own scripts.

use super::*;

pub(super) fn inject_pages(runtime: &Path, directory: &Path) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            let name = entry.file_name();
            if directory == runtime && (name == DIRECTORY || name == "__misty_sync__") {
                continue;
            }
            inject_pages(runtime, &path)?;
            continue;
        }
        let is_page = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"));
        if !kind.is_file()
            || !is_page
            || entry.metadata().map_or(true, |m| m.len() > MAX_PAGE_BYTES)
        {
            continue;
        }
        let Ok(page) = fs::read_to_string(&path) else {
            continue;
        };
        if let Some(updated) = inject_page(&page) {
            fs::write(&path, updated).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Places the layer before the page's first script. Returns `None` when the
/// page already loads the current layer; an older layer's tags are replaced.
pub(super) fn inject_page(page: &str) -> Option<String> {
    let tags: String = script_paths()
        .iter()
        .map(|p| format!("<script src=\"/{p}\"></script>"))
        .collect();
    if page.contains(&tags) {
        return None;
    }
    let first = format!("<script src=\"/{}\"></script>", script_paths()[0]);
    if let Some(at) = page.find(&first) {
        let mut rest = page.to_owned();
        for path in script_paths() {
            rest = rest.replacen(&format!("<script src=\"/{path}\"></script>"), "", 1);
        }
        return Some(format!("{}{}{}", &rest[..at], tags, &rest[at..]));
    }
    let lower = page.to_ascii_lowercase();
    let after_tag = |name: &str| {
        let start = lower.find(&format!("<{name}"))?;
        let next = lower.as_bytes().get(start + name.len() + 1)?;
        (*next == b'>' || next.is_ascii_whitespace())
            .then(|| lower[start..].find('>').map(|end| start + end + 1))
            .flatten()
    };
    let at = after_tag("head")
        .or_else(|| after_tag("html"))
        .or_else(|| {
            lower
                .find("<!doctype")
                .and_then(|s| lower[s..].find('>').map(|e| s + e + 1))
        })
        .unwrap_or(0);
    Some(format!("{}{}{}", &page[..at], tags, &page[at..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_injection_runs_before_page_scripts_and_is_idempotent() {
        let page = "<!doctype html><html><HEAD><script src=\"popup.js\"></script></head></html>";
        let updated = inject_page(page).unwrap();
        let compat = updated.find("/__misty_compat__/core.js").unwrap();
        assert!(compat < updated.find("popup.js").unwrap());
        assert!(updated.find("<HEAD>").unwrap() < compat);
        assert!(inject_page(&updated).is_none());
        let older = "<head><script src=\"/__misty_compat__/core.js\"></script><script src=\"popup.js\"></script></head>";
        let upgraded = inject_page(older).unwrap();
        assert!(upgraded.contains("/__misty_compat__/declarative.js"));
        assert_eq!(upgraded.matches("/__misty_compat__/core.js").count(), 1);
        assert!(upgraded.find("declarative.js").unwrap() < upgraded.find("popup.js").unwrap());
        assert!(inject_page("<header>").unwrap().starts_with("<script"));
    }
}
