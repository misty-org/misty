//! The Tauri plugins and the app-wide menu and window event handlers.
use crate::{infra, platform, shell_plugins};
use tauri::{Builder, Wry};

pub fn register(builder: Builder<Wry>) -> Builder<Wry> {
    // Register this first so duplicate launches are rejected before any other
    // plugin or application service can initialize a second Misty runtime.
    infra::default_browser::remember_launch(std::env::args().skip(1));
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        if !platform::plugins::mac_rounded_corners::main_window_ready() {
            return;
        }
        if let Some(window) = infra::space_windows::primary(app) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        } else {
            let _ = infra::space_windows::restore(app);
        }
        // Links opened while Misty runs, as the default browser, go to the Space
        // that claims their site, else to the last focused Space window.
        let urls = infra::default_browser::web_urls(args.iter().skip(1));
        if !urls.is_empty() {
            infra::space_windows::route_app_links(app, urls);
        }
    }));

    // Web APIs that website tabs reach natively; see kiri/README.md.
    #[cfg(desktop)]
    let builder = builder.plugin(infra::browser::kiri_host::plugin());

    // WebKit can end a page's process while Misty is in the background; reload
    // it as Tauri would, and log which page it was.
    #[cfg(target_os = "macos")]
    let builder =
        builder.on_web_content_process_terminate(infra::browser_process_ended::page_process_ended);

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder
        // Keeps privileged windows on the bundled app; see navigation_guard.rs.
        .plugin(platform::navigation_guard::init())
        // Replaces Tauri's asset handler so website views cannot read local files.
        .register_asynchronous_uri_scheme_protocol("asset", |context, request, responder| {
            platform::asset_protocol::handle(context, request, responder)
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keystore::init())
        .plugin(shell_plugins::ShellScriptPlugin(
            tauri_plugin_notification::init(),
        ))
        .plugin(shell_plugins::ShellScriptPlugin(tauri_plugin_opener::init()))
        .plugin(tauri_plugin_os::init());

    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        #[cfg(target_os = "macos")]
        if infra::app_menu::handle_menu_event(app, id) {
            return;
        }
        infra::tray::handle_menu_event(app, id);
    });

    builder.on_window_event(|window, event| {
        platform::app_lifecycle::window_event(window, event);
        #[cfg(desktop)]
        infra::space_windows::window_event(window, event);
        #[cfg(all(desktop, not(target_os = "macos")))]
        {
            if !infra::space_windows::is_app_window(window.label()) {
                return;
            }

            let tauri::WindowEvent::Resized(size) = event else {
                return;
            };

            let Some(webview) = window
                .webviews()
                .into_iter()
                .find(|webview| webview.label() == window.label())
            else {
                return;
            };

            let _ = webview.set_bounds(tauri::Rect {
                position: tauri::Position::Physical(tauri::PhysicalPosition::new(0, 0)),
                size: tauri::Size::Physical(*size),
            });
        }
        // macOS owns live window layout. Traffic lights are positioned
        // during window setup; rewriting their frames on every resize
        // competes with AppKit and makes the titlebar controls jitter.
    })
}
