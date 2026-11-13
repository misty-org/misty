// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! "Open in browser" for a local HTML file, from the file tree and the changes panel.
//!
//! The file goes to the person's default web browser, not to the default app for `.html`: on a
//! developer's computer that is often an editor, and "open in browser" opening an editor would
//! be wrong.

use std::path::{Path, PathBuf};

/// Mirrors `isHtmlFile` in the editor. The check also keeps this from becoming a "launch this
/// file" command: the fallback hands the path to the system's default handler, which for
/// `.command`, `.app` or `.exe` would run it.
const HTML_EXTENSIONS: [&str; 3] = ["html", "htm", "xhtml"];

pub(super) fn is_html_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            HTML_EXTENSIONS
                .iter()
                .any(|allowed| ext.eq_ignore_ascii_case(allowed))
        })
}

/// The real path of an existing HTML file. The ending is checked on the real path, so a
/// `page.html` link to a script is refused.
pub(super) fn resolve_html_file(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("No file was named.".into());
    }
    let real = file_access::fs::canonicalize(path)
        .map_err(|error| format!("{} can't be found: {error}", path.display()))?;
    if !file_access::fs::is_file(&real) {
        return Err(format!("{} isn't a file.", path.display()));
    }
    if !is_html_path(&real) {
        return Err(format!("{} isn't an HTML file.", path.display()));
    }
    Ok(super::plain_path(&real))
}

/// The app that opens `https://` links: the default browser.
#[cfg(target_os = "macos")]
fn default_browser_app() -> Option<PathBuf> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};
    let probe = NSURL::URLWithString(&NSString::from_str("https://example.com"))?;
    NSWorkspace::sharedWorkspace()
        .URLForApplicationToOpenURL(&probe)?
        .to_file_path()
}

/// Opens a local HTML file in the default browser. macOS names the browser (`open -a`) and only
/// falls back to the file's default app when no browser is registered; Windows and Linux use
/// the default app for `.html`, which is the browser unless the person changed it.
pub(super) async fn open_in_browser(path: &Path) -> Result<(), String> {
    let file = resolve_html_file(path)?;
    #[cfg(target_os = "macos")]
    {
        let mut command = tokio::process::Command::new("/usr/bin/open");
        if let Some(browser) = default_browser_app() {
            command.arg("-a").arg(browser);
        }
        let status = command
            .arg(&file)
            .stdin(std::process::Stdio::null())
            .status()
            .await
            .map_err(|error| format!("The browser could not be opened: {error}"))?;
        if status.success() {
            return Ok(());
        }
        Err(format!(
            "The browser could not be opened ({}).",
            super::format_exit_detail(status.code())
        ))
    }
    #[cfg(not(target_os = "macos"))]
    {
        tauri_plugin_opener::open_path(&file, None::<&str>)
            .map_err(|error| format!("The browser could not be opened: {error}"))
    }
}

#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("misty-open-browser-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn file(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, "<!doctype html>").unwrap();
            path
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn html_endings_match_whatever_their_case() {
        for name in ["a.html", "a.htm", "a.xhtml", "A.HTML", "design draft.Htm"] {
            assert!(is_html_path(Path::new(name)), "{name}");
        }
        for name in ["a.md", "a.html.txt", "html", "a.command", "a.shtml"] {
            assert!(!is_html_path(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn resolves_an_existing_html_file() {
        let scratch = Scratch::new();
        let file = scratch.file("pr flow-design.html");
        let resolved = resolve_html_file(&file).unwrap();
        assert_eq!(resolved, std::fs::canonicalize(&file).unwrap());
    }

    #[test]
    fn refuses_other_files_missing_ones_and_folders() {
        let scratch = Scratch::new();
        let script = scratch.file("run.command");
        assert!(resolve_html_file(&script)
            .unwrap_err()
            .contains("isn't an HTML file"));
        let missing = scratch.0.join("gone.html");
        assert!(resolve_html_file(&missing)
            .unwrap_err()
            .contains("can't be found"));
        let dir = scratch.0.join("site.html");
        std::fs::create_dir(&dir).unwrap();
        assert!(resolve_html_file(&dir)
            .unwrap_err()
            .contains("isn't a file"));
        assert!(resolve_html_file(Path::new("")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_an_html_named_link_to_another_file() {
        let scratch = Scratch::new();
        let script = scratch.file("run.command");
        let link = scratch.0.join("page.html");
        std::os::unix::fs::symlink(&script, &link).unwrap();
        assert!(resolve_html_file(&link)
            .unwrap_err()
            .contains("isn't an HTML file"));
    }
}
