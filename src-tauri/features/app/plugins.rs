use crate::app::shell_plugins;
use tauri::{Builder, Wry};

pub fn register(builder: Builder<Wry>) -> Builder<Wry> {
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if !crate::app::macos_window_effects::mac_rounded_corners::main_window_ready() {
            return;
        }
        if let Some(window) = crate::browser::app_windows::primary(app) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        } else {
            let _ = crate::browser::app_windows::restore(app);
        }
    }));

    #[cfg(desktop)]
    let builder = builder.plugin(crate::browser::kiri_link::kiri_host::plugin());

    #[cfg(target_os = "macos")]
    let builder = builder
        .on_web_content_process_terminate(crate::browser::pages::process_ended::page_process_ended);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder
        .plugin(crate::app::trusted_windows::navigation_guard::init())
        .register_asynchronous_uri_scheme_protocol("asset", |context, request, responder| {
            crate::app::trusted_windows::asset_protocol::handle(context, request, responder)
        })
        .register_asynchronous_uri_scheme_protocol(
            crate::project::file_protocol::SCHEME,
            crate::project::file_protocol::handle,
        )
        .register_asynchronous_uri_scheme_protocol(
            crate::files::protocol::SCHEME,
            crate::files::protocol::handle,
        )
        .register_asynchronous_uri_scheme_protocol(
            crate::apps::scheme::SCHEME,
            crate::apps::scheme::handle,
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keystore::init())
        .plugin(shell_plugins::ShellScriptPlugin(tauri_plugin_opener::init()))
        .plugin(crate::app::platform_info::plugin());

    #[cfg(windows)]
    let builder = builder.plugin(crate::app::windows::window_icon::plugin());

    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(shell_plugins::ShellScriptPlugin(
        tauri_plugin_notification::init(),
    ));

    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        #[cfg(target_os = "macos")]
        if crate::app::app_menu::handle_menu_event(app, id) {
            return;
        }
        crate::app::tray::handle_menu_event(app, id);
    });

    let builder = builder.on_webview_event(|webview, event| {
        crate::app::dropped_files::webview_event(webview, event);
    });

    builder.on_window_event(|window, event| {
        crate::app::lifecycle::window_event(window, event);
        crate::app::dropped_files::window_event(window, event);
        #[cfg(windows)]
        if let tauri::WindowEvent::ScaleFactorChanged { .. } = event {
            crate::app::windows::window_icon::apply(window);
        }
        #[cfg(desktop)]
        crate::browser::app_windows::window_event(window, event);
        #[cfg(all(desktop, not(target_os = "macos")))]
        {
            if !crate::browser::app_windows::is_app_window(window.label()) {
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
    })
}
