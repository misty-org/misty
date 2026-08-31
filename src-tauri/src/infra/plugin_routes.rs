pub(super) fn plugin_app_route(
    plugin_id: &str,
    plugin_name: &str,
    selected_path: Option<&str>,
) -> String {
    let mut route = format!(
        "/apps/{}?name={}",
        route_encode(plugin_id),
        route_encode(plugin_name)
    );
    if let Some(selected_path) = selected_path.filter(|path| !path.trim().is_empty()) {
        route.push_str("&selected=");
        route.push_str(&route_encode(selected_path));
    }
    route
}

fn route_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            encoded.push(ch);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}
