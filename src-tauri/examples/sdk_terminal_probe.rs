//! Real macOS SDK -> RPC -> PTY probe. Requires the desktop Vite server on 5173.
//! Uses a temporary WebView profile and shell home configuration; no account.
#![allow(dead_code)]
#[path = "../src/infra/ssh_terminal.rs"]
mod ssh_terminal;
#[path = "../src/infra/terminal.rs"]
mod terminal;

struct ProbeNonce(String);
#[tauri::command]
fn sdk_probe_complete(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProbeNonce>,
    nonce: String,
    success: bool,
    message: String,
) -> Result<(), String> {
    if nonce != state.0 {
        return Err("Invalid probe nonce".into());
    }
    println!("{message}");
    app.exit(if success { 0 } else { 1 });
    Ok(())
}
fn main() {
    let fixture = tempfile::tempdir().unwrap();
    let profile = tempfile::tempdir().unwrap();
    let nonce = uuid::Uuid::new_v4().to_string();
    let component_probe = std::env::var("MISTY_SDK_COMPONENT_PROBE").as_deref() == Ok("1");
    let page = if component_probe {
        "sdk-component-probe.html"
    } else {
        "sdk-terminal-probe.html"
    };
    let mut url = url::Url::parse(&format!("http://127.0.0.1:5173/scripts/{page}")).unwrap();
    url.query_pairs_mut()
        .append_pair("fixture", fixture.path().to_str().unwrap())
        .append_pair("nonce", &nonce);
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.misty.sdk-terminal-probe".into();
    context.config_mut().build.dev_url = Some(url::Url::parse("http://127.0.0.1:5173").unwrap());
    let profile_path = profile.path().to_owned();
    let code = tauri::Builder::default()
        .manage(ProbeNonce(nonce))
        .invoke_handler(tauri::generate_handler![
            sdk_probe_complete,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            ssh_terminal::terminal_ssh_environments,
            ssh_terminal::terminal_ssh_preflight,
            ssh_terminal::terminal_ssh_trust_host
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                .title("Misty SDK terminal probe")
                .visible(component_probe)
                .focused(false)
                .inner_size(1100.0, 600.0)
                .data_directory(profile_path)
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(25));
                eprintln!("SDK terminal probe watchdog expired");
                handle.exit(1);
            });
            Ok(())
        })
        .build(context)
        .unwrap()
        .run_return(|_, _| {});
    drop(fixture);
    drop(profile);
    std::process::exit(code);
}
