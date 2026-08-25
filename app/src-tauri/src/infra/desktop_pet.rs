use tauri::{
    utils::config::BackgroundThrottlingPolicy, App, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};

const PET_LABEL: &str = "misty-bot-pet";

pub fn setup(app: &mut App<Wry>) -> tauri::Result<()> {
    if app.get_webview_window(PET_LABEL).is_none() {
        // One native surface grows into Misty Search, then settles back at the orb's saved point.
        WebviewWindowBuilder::new(
            app,
            PET_LABEL,
            WebviewUrl::App("index.html?misty-surface=pet".into()),
        )
        .title("Misty")
        .inner_size(164.0, 164.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .accept_first_mouse(true)
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .build()?;
    }

    Ok(())
}
