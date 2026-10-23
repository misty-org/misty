use super::*;

#[test]
fn background_scripts_and_workers_load_the_layer_first() {
    let root = tempfile::tempdir().unwrap();
    let mut manifest = json!({"background":{"scripts":["bg.js"]}});
    inject_background(root.path(), &mut manifest).unwrap();
    assert_eq!(
        manifest["background"]["scripts"][0],
        "__misty_compat__/core.js"
    );
    assert_eq!(manifest["background"]["scripts"][9], "bg.js");
    inject_background(root.path(), &mut manifest).unwrap();
    assert_eq!(
        manifest["background"]["scripts"].as_array().unwrap().len(),
        10
    );
    // An older layer's list becomes the current one.
    let mut manifest = json!({"background":{"scripts":["__misty_compat__/core.js","bg.js"]}});
    inject_background(root.path(), &mut manifest).unwrap();
    assert_eq!(
        manifest["background"]["scripts"].as_array().unwrap().len(),
        10
    );
    assert_eq!(manifest["background"]["scripts"][9], "bg.js");

    fs::create_dir(root.path().join(DIRECTORY)).unwrap();
    let mut manifest = json!({"background":{"service_worker":"sw.js"}});
    inject_background(root.path(), &mut manifest).unwrap();
    assert_eq!(manifest["background"]["service_worker"], WORKER);
    let worker = fs::read_to_string(root.path().join(WORKER)).unwrap();
    assert!(worker.starts_with("importScripts(\"/__misty_compat__/core.js\""));
    assert!(worker.contains("\"/sw.js\""));
    // Rewriting our own worker keeps the extension's worker last.
    inject_background(root.path(), &mut manifest).unwrap();
    let again = fs::read_to_string(root.path().join(WORKER)).unwrap();
    assert_eq!(again, worker);
}

#[test]
fn sidebar_and_page_actions_become_toolbar_popups() {
    let mut manifest = json!({"manifest_version":2,"sidebar_action":{"default_panel":"panel.html","default_title":"Panel"}});
    add_toolbar_action(&mut manifest);
    assert_eq!(manifest["browser_action"]["default_popup"], "panel.html");
    let mut manifest =
        json!({"manifest_version":2,"browser_action":{},"page_action":{"default_popup":"p.html"}});
    add_toolbar_action(&mut manifest);
    assert_eq!(manifest["browser_action"], json!({}));
    let mut manifest = json!({"manifest_version":3,"side_panel":{"default_path":"panel.html"}});
    add_toolbar_action(&mut manifest);
    assert_eq!(manifest["action"]["default_popup"], "panel.html");
}
