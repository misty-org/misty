//! Interactive smoke test using the real Host permission UI and built Storage
//! Report package. Start Vite on port 5173 and build misty-apps extensions first.
#![allow(dead_code)]
#[path = "../src/platform/app_command_policy.rs"]
mod app_command_policy;
#[path = "../src/platform/mini_app.rs"]
mod mini_app;
use tauri::Manager;

#[tauri::command]
fn workflow_geometry(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<serde_json::Value, String> {
    if webview.label() != "main" {
        return Err("Host only".into());
    }
    let window = webview.window();
    Ok(serde_json::json!({
        "windowInner":format!("{:?}",window.inner_position()),
        "windowOuter":format!("{:?}",window.outer_position()),
        "views":app.webviews().into_iter().map(|(label,view)|serde_json::json!({"label":label,"bounds":format!("{:?}",view.bounds())})).collect::<Vec<_>>()
    }))
}

fn copy_tree(source: &std::path::Path, target: &std::path::Path) {
    std::fs::create_dir_all(target).unwrap();
    for entry in std::fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target.join(entry.file_name()));
        } else {
            std::fs::copy(entry.path(), target.join(entry.file_name())).unwrap();
        }
    }
}
fn main() {
    let plugins = dirs::home_dir().unwrap().join(".misty/plugins/private");
    std::fs::create_dir_all(&plugins).unwrap();
    let package = tempfile::Builder::new()
        .prefix("storage-workflow-test-")
        .tempdir_in(plugins)
        .unwrap();
    let plugin = if std::env::args().any(|arg| arg == "--themes") {
        "themes"
    } else if std::env::args().any(|arg| arg == "--optimizer") {
        "image_optimizer"
    } else if std::env::args().any(|arg| arg == "--convert") {
        "quick_convert"
    } else {
        "storage_report"
    };
    let built = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../misty-apps/dist/plugins")
        .join(plugin);
    copy_tree(&built, package.path());
    let fixture = tempfile::Builder::new()
        .prefix("misty-folder-workflow-")
        .tempdir()
        .unwrap();
    std::fs::write(fixture.path().join("example.txt"), "hello").unwrap();
    std::fs::create_dir(fixture.path().join("nested")).unwrap();
    std::fs::write(fixture.path().join("nested/second.txt"), "world!").unwrap();
    if plugin == "image_optimizer" || plugin == "quick_convert" {
        let image = image::RgbImage::from_fn(256, 256, |x, y| {
            image::Rgb([x as u8, y as u8, (x ^ y) as u8])
        });
        image.save(fixture.path().join("photo.png")).unwrap();
        std::fs::create_dir(fixture.path().join("outputs")).unwrap();
    }
    let source = format!(
        "misty-extension://localhost/private/{}/web/index.html?hosted=1&plugin={plugin}",
        package.path().file_name().unwrap().to_str().unwrap()
    );
    let mut url = url::Url::parse("http://127.0.0.1:5173/scripts/mini-app-workflow.html").unwrap();
    url.query_pairs_mut()
        .append_pair("source", &source)
        .append_pair(
            "title",
            match plugin {
                "themes" => "Themes",
                "image_optimizer" => "Image Optimizer",
                "quick_convert" => "Quick Convert",
                _ => "Storage Report",
            },
        )
        .append_pair("folder", fixture.path().to_str().unwrap());
    println!(
        "Workflow fixture: {} (mode: {plugin})",
        fixture.path().display()
    );
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.misty.runtime-workflow-test".into();
    let profile = tempfile::tempdir().unwrap();
    let profile_path = profile.path().to_owned();
    let exit = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(mini_app::MiniAppState::default())
        .register_uri_scheme_protocol("misty-mini-app", mini_app::handle)
        .invoke_handler({
            let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
                Box::new(tauri::generate_handler![
                    workflow_geometry,
                    mini_app::mini_app_open,
                    mini_app::mini_app_close,
                    mini_app::mini_app_layout,
                    mini_app::mini_app_rpc,
                    mini_app::mini_app_reply,
                    mini_app::mini_app_post,
                    mini_app::permissions::mini_app_context,
                    mini_app::permissions::mini_app_permission_status,
                    mini_app::permissions::mini_app_permission_list,
                    mini_app::permissions::mini_app_permission_decide,
                    mini_app::permissions::mini_app_device_call
                ]);
            move |invoke| {
                if !app_command_policy::allows(
                    invoke.message.webview_ref().label(),
                    invoke.message.command(),
                ) {
                    invoke.resolver.reject("Content view denied.");
                    return true;
                }
                handler(invoke)
            }
        })
        .setup(move |app| {
            let builder =
                tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                    .title("Misty App workflow test")
                    .inner_size(900., 780.)
                    .data_directory(profile_path);
            #[cfg(target_os = "macos")]
            let builder = if std::env::args().any(|arg| arg == "--overlay") {
                builder.title_bar_style(tauri::TitleBarStyle::Overlay)
            } else {
                builder
            };
            builder.build()?;
            Ok(())
        })
        .build(context)
        .unwrap()
        .run_return(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                mini_app::shutdown(app);
            }
        });
    drop(package);
    drop(fixture);
    drop(profile);
    std::process::exit(exit);
}
