//! Live WebView2 probe for the page layer in cross-origin frames on Windows. A local page on
//! one site embeds a frame from another site (its own process), one from its own site on
//! another origin (the page's process) and, inside the first, one nested from the page's
//! site again (attached through the first frame's session). The probe reads all three,
//! types into the out-of-process one by its frame ref and checks the field took the text.
//! Run with `cargo test --lib webview2_frames -- --ignored`.
use super::{frame_of, markdown, shows, trees, REF_RANGE};
use crate::infra::{browser_content_world::evaluate_in_frame, browser_frames};
use serde_json::json;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicI32, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{LogicalPosition, LogicalSize, Webview, WebviewBuilder, WebviewUrl};

fn serve() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the probe server");
    let port = listener.local_addr().expect("probe server address").port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || answer(stream, port));
        }
    });
    port
}

fn answer(mut stream: TcpStream, port: u16) {
    let mut request = [0u8; 4096];
    let read = stream.read(&mut request).unwrap_or(0);
    let request = String::from_utf8_lossy(&request[..read]);
    let body = match request.split_whitespace().nth(1).unwrap_or("/") {
        "/" => format!(
            r#"<!doctype html><title>Studio</title><h1>Class Schedule</h1>
<iframe title="Booking" src="http://127.0.0.1:{port}/widget" width="520" height="320"></iframe>
<iframe title="Map" src="http://map.misty.localhost:{port}/map" width="420" height="160"></iframe>"#
        ),
        "/widget" => format!(
            r#"<!doctype html><p>Booking widget</p><label>Your name <input id="name"></label>
<iframe title="Times" src="http://times.misty.localhost:{port}/times" width="360" height="120"></iframe>"#
        ),
        "/map" => "<!doctype html><p>12 Main Street</p>".to_owned(),
        "/times" => "<!doctype html><p>Tuesday 7 PM</p>".to_owned(),
        _ => String::new(),
    };
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn check(name: &str, ok: bool, detail: impl std::fmt::Debug) -> Result<(), String> {
    if ok {
        println!("PASS: {name}");
        Ok(())
    } else {
        Err(format!("{name}: {detail:?}"))
    }
}

async fn exercise(view: &Webview, port: u16) -> Result<(), String> {
    browser_frames::install(view)?;
    let top = format!("http://studio.misty.localhost:{port}/");
    view.navigate(top.parse().map_err(|_| "probe address")?)
        .map_err(|error| error.to_string())?;
    let wanted = ["Your name", "12 Main Street", "Tuesday 7 PM"];
    let mut reads = Vec::new();
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        reads = trees(view).await;
        let all: String = reads.iter().map(|read| read.text.as_str()).collect();
        if wanted.iter().all(|text| all.contains(text)) {
            break;
        }
    }
    let all: String = reads.iter().map(|read| read.text.as_str()).collect();
    check(
        "snapshots read every cross-origin frame",
        wanted.iter().all(|text| all.contains(text)),
        &reads,
    )?;

    let label = view.label();
    let frames = browser_frames::list(view).await;
    let runs_in_session = |host: &str| {
        frames
            .iter()
            .find(|frame| frame.url.contains(host))
            .and_then(|frame| browser_frames::target(label, frame.id))
            .map(|target| target.session.is_some())
    };
    check(
        "each frame runs where its process is",
        runs_in_session("127.0.0.1") == Some(true)
            && runs_in_session("times.misty.localhost") == Some(true)
            && runs_in_session("map.misty.localhost") == Some(false),
        &frames,
    )?;

    let widget = reads
        .iter()
        .find(|read| read.text.contains("Your name"))
        .ok_or("no widget read")?;
    let reference = widget
        .text
        .lines()
        .find(|line| line.contains("textbox"))
        .and_then(|line| line.split("[ref=").nth(1))
        .and_then(|rest| rest.split(']').next())
        .ok_or_else(|| format!("no field ref in {}", widget.text))?
        .to_owned();
    let number: u64 = reference[1..].parse().map_err(|_| "ref number")?;
    check(
        "the frame's refs come from its own range",
        number > REF_RANGE,
        &reference,
    )?;
    let (frame, document) = frame_of(label, &reference).ok_or("the ref routes to no frame")?;
    let step = |action: &str| json!({"documentId": document, "step": {"action": action, "ref": reference, "text": "Ada Lovelace"}});
    let focused = super::super::call_at(view, Some(frame), "perform", step("focus"), false).await?;
    let filled = super::super::call_at(view, Some(frame), "perform", step("fill"), false).await?;
    check(
        "a step on the frame's ref runs in that frame",
        focused["ok"] == true && filled["ok"] == true,
        (&focused, &filled),
    )?;
    let value = evaluate_in_frame(
        view.clone(),
        "misty-frames-probe",
        "return document.getElementById('name').value;".to_owned(),
        frame,
    )
    .await?;
    check("the field took the text", value == "Ada Lovelace", &value)?;

    check(
        "waits see text inside frames",
        shows(view, &json!({"text": "Tuesday 7 PM"})).await,
        "no frame showed it",
    )?;
    let texts = markdown(view).await;
    check(
        "extraction includes frame text",
        texts
            .iter()
            .any(|read| read.text.contains("12 Main Street")),
        &texts,
    )?;
    Ok(())
}

#[test]
#[ignore = "starts WebView2 and a local server; run explicitly"]
fn webview2_frames_read_and_type_across_origins() {
    let port = serve();
    let status = Arc::new(AtomicI32::new(1));
    let output = status.clone();
    let root = tempfile::tempdir().expect("create a disposable profile");
    let data = root.path().to_path_buf();
    tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            let window = tauri::WindowBuilder::new(app, "frames-probe")
                .title("Misty frames probe")
                .inner_size(720.0, 640.0)
                .build()?;
            let view = window.add_child(
                WebviewBuilder::new(
                    "frames-probe-page",
                    WebviewUrl::External("about:blank".parse()?),
                )
                .data_directory(data),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(720.0, 640.0),
            )?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(60), exercise(&view, port))
                    .await
                    .unwrap_or(Err("probe timeout".into()));
                if let Err(message) = &result {
                    eprintln!("FAIL: {message}");
                }
                let code = if result.is_ok() { 0 } else { 1 };
                status.store(code, Ordering::SeqCst);
                handle.exit(code);
            });
            Ok(())
        })
        .build(tauri::generate_context!(
            "examples/cookie-store-probe/tauri.conf.json"
        ))
        .expect("build the frames probe")
        .run_return(|_, _| {});
    let code = output.load(Ordering::SeqCst);
    // WebView2 keeps profile files open briefly after the views close.
    for _ in 0..50 {
        if std::fs::remove_dir_all(root.path()).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(code, 0, "the frames probe failed");
}
