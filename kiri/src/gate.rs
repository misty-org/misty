use crate::KiriError;
use url::Url;

/// Who is calling, as established by Kiri rather than claimed by the page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    /// The embedder's label for the webview that sent the call.
    pub webview: String,
    /// The top-level document's origin, e.g. `https://accounts.google.com`.
    pub origin: String,
    /// Whether the origin is a secure context (HTTPS or loopback).
    pub secure: bool,
}

impl Caller {
    /// Builds the caller from the webview's committed URL. Nothing in the
    /// request payload contributes to the identity.
    pub fn from_page(webview: &str, page_url: &Url) -> Result<Self, KiriError> {
        let secure = match page_url.scheme() {
            "https" => true,
            "http" => is_loopback(page_url),
            _ => return Err(KiriError::security("Kiri serves only web pages.")),
        };
        let origin = page_url.origin();
        if !origin.is_tuple() {
            return Err(KiriError::security("The page has an opaque origin."));
        }
        Ok(Self {
            webview: webview.to_owned(),
            origin: origin.ascii_serialization(),
            secure,
        })
    }
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(domain)) => {
            domain == "localhost" || domain.ends_with(".localhost")
        }
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caller(url: &str) -> Result<Caller, KiriError> {
        Caller::from_page("misty-browser-1", &Url::parse(url).unwrap())
    }

    #[test]
    fn origin_comes_from_the_committed_url() {
        let caller = caller("https://accounts.google.com/signin/v2?continue=https%3A%2F%2Fevil.example").unwrap();
        assert_eq!(caller.origin, "https://accounts.google.com");
        assert!(caller.secure);
    }

    #[test]
    fn plain_http_is_secure_only_on_loopback() {
        assert!(!caller("http://example.com/").unwrap().secure);
        assert!(caller("http://localhost:5173/").unwrap().secure);
        assert!(caller("http://app.localhost/").unwrap().secure);
        assert!(caller("http://127.0.0.1:8080/").unwrap().secure);
        assert!(caller("http://[::1]/").unwrap().secure);
    }

    #[test]
    fn non_web_pages_are_refused() {
        for url in ["about:blank", "file:///etc/passwd", "data:text/html,hi", "tauri://localhost/"] {
            assert_eq!(caller(url).unwrap_err().name, "SecurityError", "{url}");
        }
    }
}
