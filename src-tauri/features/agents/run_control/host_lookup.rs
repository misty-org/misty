//! Whether an address an agent is about to open has no DNS record at all. An agent that guessed a
//! wrong spelling opened it twice, got pages that never loaded and called the site a blocker, so it
//! hears before any tab opens. Only a definite "no such host" counts: a slow or failing lookup leaves
//! the page to load.
use std::{io, time::Duration};

const LOOKUP_LIMIT: Duration = Duration::from_secs(3);
/// A name that always exists. macOS answers "no such host" for every name while it's offline, so a
/// missing name only means something once this one resolves.
const ALWAYS_THERE: &str = "example.com";

/// What the system resolver says when a name has no record, in each system's words. Windows' are
/// translated, so it goes by the code (`WSAHOST_NOT_FOUND`).
fn says_no_such_host(error: &io::Error) -> bool {
    if error.raw_os_error() == Some(11001) {
        return true;
    }
    let text = error.to_string().to_lowercase();
    [
        "nodename nor servname",
        "name or service not known",
        "no such host",
    ]
    .iter()
    .any(|words| text.contains(words))
}

async fn lookup(host: &str) -> Option<io::Result<()>> {
    let found = tokio::time::timeout(LOOKUP_LIMIT, tokio::net::lookup_host((host, 443))).await;
    found.ok().map(|result| result.map(|_| ()))
}

async fn host_missing(host: &str) -> bool {
    let Some(Err(error)) = lookup(host).await else {
        return false;
    };
    says_no_such_host(&error) && matches!(lookup(ALWAYS_THERE).await, Some(Ok(())))
}

fn not_a_public_name(host: &str) -> bool {
    super::run_taint::private_host(&format!("https://{host}/")).is_some()
}

#[tauri::command]
pub async fn agent_host_missing(webview: tauri::Webview, host: String) -> Result<bool, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can check an address.".into());
    }
    // Whether an internal name resolves says something about the network this computer is on, which
    // an agent has no business learning from what a page told it to try.
    if host.is_empty() || host.len() > 253 || not_a_public_name(&host) {
        return Ok(false);
    }
    Ok(host_missing(&host).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_names_are_never_looked_up() {
        for host in [
            "intranet",
            "git.corp",
            "nas.local",
            "192.168.1.1",
            "router.home.arpa",
        ] {
            assert!(not_a_public_name(host), "{host}");
        }
        assert!(!not_a_public_name("example.com"));
    }

    #[test]
    fn only_a_definite_answer_counts() {
        let said = |text: &str| says_no_such_host(&io::Error::other(text.to_owned()));
        assert!(said(
            "failed to lookup address information: nodename nor servname provided, or not known"
        ));
        assert!(said(
            "failed to lookup address information: Name or service not known"
        ));
        assert!(!said(
            "failed to lookup address information: Temporary failure in name resolution"
        ));
        assert!(!said("connection refused"));
        assert!(says_no_such_host(&io::Error::from_raw_os_error(11001)));
    }
}
