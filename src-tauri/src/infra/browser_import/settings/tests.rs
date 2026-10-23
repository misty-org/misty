use super::*;

#[test]
fn reads_chromium_preferences() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
            dir.path().join("Preferences"),
            r#"{"homepage":"https://home.example/","homepage_is_newtabpage":false,
               "session":{"restore_on_startup":1},"bookmark_bar":{"show_on_all_tabs":true},
               "default_search_provider_data":{"template_url_data":{"short_name":"DuckDuckGo","url":"https://duckduckgo.com/?q={searchTerms}"}},
               "profile":{"content_settings":{"exceptions":{
                 "media_stream_camera":{"https://meet.example:443,*":{"setting":1},"[*.]wild.example,*":{"setting":1}},
                 "media_stream_mic":{"https://meet.example:443,*":{"setting":2}}}}}}"#,
        )
        .unwrap();
    let settings = read(Family::Chromium, dir.path());
    assert_eq!(settings.homepage.as_deref(), Some("https://home.example/"));
    assert_eq!(settings.restore_session, Some(true));
    assert_eq!(settings.search_engine.unwrap().name, "DuckDuckGo");
    assert_eq!(
        settings.site_permissions,
        vec![
            SitePermission {
                origin: "https://meet.example".into(),
                kind: "camera",
                allow: true
            },
            SitePermission {
                origin: "https://meet.example".into(),
                kind: "microphone",
                allow: false
            },
        ]
    );
}

#[test]
fn reads_firefox_prefs_and_compressed_search_settings() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
            dir.path().join("prefs.js"),
            "// Mozilla User Preferences\nuser_pref(\"browser.startup.homepage\", \"about:home|https://news.example/\");\nuser_pref(\"browser.startup.page\", 3);\nuser_pref(\"browser.toolbars.bookmarks.visibility\", \"never\");\n",
        )
        .unwrap();
    let json = br#"{"metaData":{"defaultEngineId":"ddg"},"engines":[{"id":"ddg","_name":"DuckDuckGo","_urls":[{"template":"https://duckduckgo.com/?q={searchTerms}"}]}]}"#;
    let mut file = b"mozLz40\0".to_vec();
    file.extend((json.len() as u32).to_le_bytes());
    file.extend(lz4_flex::block::compress(json));
    std::fs::write(dir.path().join("search.json.mozlz4"), file).unwrap();
    let settings = read(Family::Firefox, dir.path());
    assert_eq!(settings.homepage.as_deref(), Some("https://news.example/"));
    assert_eq!(settings.restore_session, Some(true));
    assert_eq!(
        settings.search_engine,
        Some(SearchEngine {
            name: "DuckDuckGo".into(),
            url: "https://duckduckgo.com/?q=%s".into()
        })
    );
}
