use tauri::{plugin::TauriPlugin, Manager, Runtime};
use url::Url;

pub(crate) fn hosts_websites(label: &str) -> bool {
    label.starts_with("misty-browser-")
        || label == "render-control"
        || crate::apps::frames::is_app_page(label)
}

pub fn allows(label: &str, url: &Url, dev_origin: Option<&str>) -> bool {
    if hosts_websites(label) {
        return true;
    }
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" if url.host_str() == Some("tauri.localhost") => {
            url.port().is_none() && url.username().is_empty() && url.password().is_none()
        }
        "misty-app" => url
            .host_str()
            .is_some_and(|host| host == "localhost" || crate::apps::manifest::valid_id(host)),
        "http" if url.host_str().is_some_and(app_host) => {
            url.port().is_none() && url.username().is_empty() && url.password().is_none()
        }
        "http" | "https" => {
            dev_origin.is_some_and(|origin| url.origin().ascii_serialization() == origin)
        }
        "blob" => Url::parse(url.path()).is_ok_and(|inner| allows(label, &inner, dev_origin)),
        "about" => url.as_str() == "about:blank" || url.as_str() == "about:srcdoc",
        _ => false,
    }
}

fn app_host(host: &str) -> bool {
    host == "misty-app.localhost"
        || host
            .strip_prefix("misty-app.")
            .and_then(|rest| rest.strip_suffix(".localhost"))
            .is_some_and(crate::apps::manifest::valid_id)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("misty-navigation-guard")
        .on_navigation(|webview, url| {
            let dev_origin = cfg!(debug_assertions)
                .then(|| webview.app_handle().config().build.dev_url.as_ref())
                .flatten()
                .map(|dev| dev.origin().ascii_serialization());
            allows(webview.label(), url, dev_origin.as_deref())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn privileged_views_load_only_the_bundled_app() {
        for label in [
            "space-personal",
            "misty-agent-01951d32-40ac-7000-8000-000000000001",
            "misty-cursor-1",
            "misty-bot-pet",
        ] {
            assert!(allows(label, &url("tauri://localhost/index.html"), None));
            assert!(allows(label, &url("http://tauri.localhost/settings"), None));
            assert!(allows(label, &url("https://tauri.localhost/"), None));
            assert!(allows(label, &url("about:blank"), None));
            assert!(allows(
                label,
                &url("misty-app://localhost/planner/1.0.0/index.html"),
                None
            ));
            assert!(allows(
                label,
                &url("http://misty-app.localhost/planner/1.0.0/"),
                None
            ));
            assert!(allows(
                label,
                &url("http://misty-app.planner.localhost/1.0.0/"),
                None
            ));
            assert!(!allows(
                label,
                &url("http://misty-app.a.b.localhost/1.0.0/"),
                None
            ));
            assert!(!allows(
                label,
                &url("http://misty-app.planner.localhost:8080/1.0.0/"),
                None
            ));
            assert!(allows(
                label,
                &url("misty-app://photocraft/0.23.1/index.html"),
                None
            ));
            assert!(!allows(
                label,
                &url("misty-app://Evil.com/planner/1.0.0/"),
                None
            ));
            assert!(!allows(label, &url("misty-app://a/planner/1.0.0/"), None));
            assert!(!allows(
                label,
                &url("http://misty-app.localhost.evil.com/"),
                None
            ));
            assert!(allows(
                label,
                &url("blob:tauri://localhost/3f1c0f7e-2c4b-4a6e-9a55-0b1f5f0f8f10"),
                None
            ));
            for denied in [
                "asset://localhost/%2FUsers%2Fme%2FDownloads%2Fpage.html",
                "http://asset.localhost/%2FUsers%2Fme%2FDownloads%2Fpage.html",
                "https://example.com/",
                "http://127.0.0.1:5173/",
                "http://tauri.localhost:8080/",
                "tauri://evil.example/",
                "file:///Users/me/Downloads/page.html",
                "data:text/html,<script>alert(1)</script>",
                "blob:https://example.com/3f1c0f7e-2c4b-4a6e-9a55-0b1f5f0f8f10",
                "ipc://localhost/",
                "javascript:alert(1)",
            ] {
                assert!(!allows(label, &url(denied), None), "{label}: {denied}");
            }
        }
    }

    #[test]
    fn the_dev_server_is_allowed_only_when_configured() {
        let dev = Some("http://127.0.0.1:5173");
        assert!(allows(
            "space-personal",
            &url("http://127.0.0.1:5173/"),
            dev
        ));
        assert!(!allows(
            "space-personal",
            &url("http://127.0.0.1:5174/"),
            dev
        ));
        assert!(!allows(
            "space-personal",
            &url("http://localhost:5173/"),
            dev
        ));
    }

    #[test]
    fn website_views_keep_their_own_policy() {
        for label in [
            "misty-browser-a",
            "misty-browser-storage-1",
            "misty-browser-capture-1",
            "render-control",
            "misty-app-youtube-music-0d3c9a1b2e4f5a6b7c8d9e0f",
        ] {
            assert!(allows(label, &url("https://example.com/"), None));
        }
    }
}
