use super::renderer_owned_accelerator;

#[test]
fn contextual_shortcuts_stay_owned_by_the_renderer() {
    assert!(renderer_owned_accelerator("search.toggle"));
    assert!(renderer_owned_accelerator("app.command_palette"));
    assert!(renderer_owned_accelerator("app.zoom_in"));
    assert!(renderer_owned_accelerator("app.zoom_out"));
    assert!(renderer_owned_accelerator("app.zoom_reset"));
    assert!(!renderer_owned_accelerator("app.open_settings"));
}
