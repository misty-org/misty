use super::*;
fn fixture() -> AskContext {
    let page: PageContext = serde_json::from_value(json!({
            "url": "https://example.com/article", "documentRevision": "1:2", "title": "Pilot", "content": "Please reply", "selection": false, "editable": false, "link": "", "image": ""
        })).unwrap();
    AskContext {
        id: "view".into(),
        scope_id: "scope".into(),
        space_id: Some("family".into()),
        profile_id: Some("profile".into()),
        provider_id: None,
        revision: "1:2".into(),
        content_hash: "hash".into(),
        page,
        intent: "ask".into(),
    }
}
#[test]
fn custom_menu_only_dispatches_presented_actions_for_its_live_key() {
    let context = fixture();
    let mut menu = PendingMenu {
        key: "current".into(),
        created: std::time::Instant::now(),
        actions: menu_actions(&context),
        context,
    };
    assert!(menu_action_allowed(&menu, "current", "ask"));
    assert!(menu_action_allowed(&menu, "current", "dismiss"));
    assert!(!menu_action_allowed(&menu, "old", "ask"));
    assert!(!menu_action_allowed(&menu, "current", "create-task"));
    assert!(!menu_action_allowed(&menu, "current", "paste"));
    assert!(!menu_action_allowed(&menu, "current", "separator"));
    menu.created -= Duration::from_secs(121);
    assert!(!menu_action_allowed(&menu, "current", "ask"));
}
#[test]
fn custom_menu_preserves_context_appropriate_browser_commands() {
    let mut context = fixture();
    context.page.selection = true;
    context.page.editable = true;
    context.page.link = "https://example.com/link".into();
    context.page.image = "https://example.com/image.png".into();
    let actions = menu_actions(&context);
    assert_eq!(actions.first().map(String::as_str), Some("ask"));
    for action in [
        "copy",
        "cut",
        "paste",
        "search-web",
        "open-link",
        "open-link-split",
        "copy-link",
        "open-image",
        "copy-image-link",
    ] {
        assert!(actions.iter().any(|a| a == action));
    }
    assert!(
        !actions.iter().any(|a| a == "reload"),
        "page commands stay off link, image, and selection menus"
    );
    context.page.editable = false;
    context.page.selection = false;
    let actions = menu_actions(&context);
    assert!(!actions
        .iter()
        .any(|a| ["copy", "cut", "paste"].contains(&a.as_str())));
}
#[test]
fn page_menu_offers_page_commands_without_stray_separators() {
    let context = fixture();
    let actions = menu_actions(&context);
    for action in [
        "back",
        "forward",
        "reload",
        "bookmark",
        "copy-page-link",
        "qr-code",
        "annotate",
    ] {
        assert!(actions.iter().any(|a| a == action), "{action}");
    }
    assert!(actions
        .windows(2)
        .all(|pair| !(pair[0] == "separator" && pair[1] == "separator")));
    assert_ne!(actions.last().map(String::as_str), Some("separator"));
}
