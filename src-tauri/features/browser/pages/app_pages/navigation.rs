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

pub(super) fn open_outside(app: &AppHandle, url: &Url) {
    use tauri_plugin_opener::OpenerExt;
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
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
}
