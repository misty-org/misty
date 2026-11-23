use super::*;

pub(super) fn stays_in_app(url: &Url, app_id: &str) -> bool {
    match url.scheme() {
        "misty-app" => url.host_str() == Some(app_id),
        "http" if cfg!(windows) => {
            url.host_str() == Some(format!("misty-app.{app_id}.localhost").as_str())
                && url.port().is_none()
                && url.username().is_empty()
                && url.password().is_none()
        }
        "blob" => Url::parse(url.path()).is_ok_and(|inner| stays_in_app(&inner, app_id)),
        "about" => url.as_str() == "about:blank" || url.as_str() == "about:srcdoc",
        _ => false,
    }
}

pub(super) fn stays_on_site(url: &Url, site: &SiteEntry) -> bool {
    match url.scheme() {
        "https" => site.allows(url),
        "blob" => Url::parse(url.path()).is_ok_and(|inner| stays_on_site(&inner, site)),
        "about" => url.as_str() == "about:blank" || url.as_str() == "about:srcdoc",
        "data" => false,
        _ => false,
    }
}

pub(super) fn offered_outside(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => url.host_str().is_some_and(|host| !host.is_empty()),
        "mailto" => true,
        _ => false,
    }
}

pub(super) fn refuse_outside(app: &AppHandle, mount: &str, app_id: &str, url: &Url) {
    eprintln!(
        "app page: {app_id} tried to leave for {}://{}, which Misty doesn't open from an app",
        url.scheme(),
        url.host_str().unwrap_or("")
    );
    if !offered_outside(url) {
        return;
    }
    let host = match url.scheme() {
        "mailto" => url.path().to_owned(),
        _ => url.host_str().unwrap_or_default().to_owned(),
    };
    crate::apps::frames::emit_page(
        app,
        mount,
        "navigation-refused",
        Some(serde_json::json!({ "url": url.as_str(), "host": host }).to_string()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn an_app_page_stays_on_its_own_origin() {
        assert!(stays_in_app(
            &url("misty-app://draw/1.0.0/index.html"),
            "draw"
        ));
        assert!(!stays_in_app(&url("misty-app://other/1.0.0/"), "draw"));
        assert!(!stays_in_app(&url("https://example.com/"), "draw"));
        assert!(stays_in_app(&url("about:blank"), "draw"));
        assert!(!stays_in_app(&url("data:text/html,hi"), "draw"));
        assert!(stays_in_app(&url("blob:misty-app://draw/0d3c"), "draw"));
        assert!(!stays_in_app(&url("blob:https://example.com/0d3c"), "draw"));
    }

    #[test]
    fn only_web_and_mail_addresses_are_offered_to_the_person() {
        assert!(offered_outside(&url("https://example.com/page")));
        assert!(offered_outside(&url("http://example.com/")));
        assert!(offered_outside(&url("mailto:ana@example.com")));
        assert!(!offered_outside(&url("file:///etc/passwd")));
        assert!(!offered_outside(&url("javascript:alert(1)")));
        assert!(!offered_outside(&url("data:text/html,hi")));
        assert!(!offered_outside(&url("misty-app://other/1.0.0/")));
    }
}
