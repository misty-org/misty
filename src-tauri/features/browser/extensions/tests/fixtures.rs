// SPDX-License-Identifier: MIT
//! Fixture extensions on disk, and the local web server their pages come from.
// Tests build fixtures with the standard library, as clippy.toml allows.
#![allow(clippy::disallowed_methods)]
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    thread,
};

/// The folder of this crate (`src-tauri`).
pub fn tauri() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn extensions() -> PathBuf {
    tauri().join("features/browser/extensions")
}

pub fn fixtures() -> PathBuf {
    extensions().join("tests/fixtures")
}

pub fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("create fixture folder");
    for entry in fs::read_dir(from).expect("read fixture folder") {
        let entry = entry.expect("entry");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("type").is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).expect("copy fixture");
        }
    }
}

/// A fixture copied into `parent`, ready to load.
pub fn fixture(parent: &Path, name: &str) -> PathBuf {
    let target = parent.join(name);
    copy_dir(&fixtures().join(name), &target);
    target
}

/// The sync bridge page Misty writes into every extension it loads.
pub fn add_sync_bridge(root: &Path) {
    let bridge = root.join("__misty_sync__");
    fs::create_dir_all(&bridge).expect("create bridge folder");
    for name in ["bridge.html", "bridge.js"] {
        fs::copy(extensions().join(name), bridge.join(name)).expect("copy bridge");
    }
}

/// The compatibility layer's pages, as `compat::apply` writes them.
pub fn add_compat_layer(root: &Path) {
    copy_dir(
        &tauri().join("features/kiri/src/extensions/compat"),
        &root.join("__misty_compat__"),
    );
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html",
        Some("js") => "text/javascript",
        Some("json") => "application/json",
        Some("png") => "image/png",
        _ => "application/octet-stream",
    }
}

fn respond(mut stream: TcpStream, root: &Path) {
    let mut buffer = vec![0_u8; 16 * 1024];
    let mut length = 0;
    let (head_end, content_length) = loop {
        let read = stream.read(&mut buffer[length..]).unwrap_or(0);
        if read == 0 {
            return;
        }
        length += read;
        if let Some(end) = buffer[..length].windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buffer[..end]).to_lowercase();
            let size = head
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .and_then(|value| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            break (end + 4, size);
        }
        if length == buffer.len() {
            return;
        }
    };
    while length < head_end + content_length {
        let read = stream.read(&mut buffer[length..]).unwrap_or(0);
        if read == 0 {
            break;
        }
        length += read;
    }
    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let mut words = head.split_whitespace();
    let (method, target) = (
        words.next().unwrap_or_default(),
        words.next().unwrap_or("/"),
    );
    let (status, kind, body): (&str, &str, Vec<u8>) = if method == "POST" {
        let title = if &buffer[head_end..length] == b"fixture=retained" {
            "POST retained"
        } else {
            "POST body lost"
        };
        (
            "200 OK",
            "text/html",
            format!("<!doctype html><title>{title}</title>").into_bytes(),
        )
    } else {
        let path = target
            .split('?')
            .next()
            .unwrap_or("/")
            .trim_start_matches('/');
        let file = root.join(path);
        match fs::read(&file) {
            Ok(bytes) if !path.is_empty() && !path.contains("..") => {
                ("200 OK", content_type(&file), bytes)
            }
            _ if path.is_empty() => (
                "200 OK",
                "text/html",
                b"<!doctype html><title>Fixture</title>".to_vec(),
            ),
            _ => ("404 Not Found", "text/plain", b"not found".to_vec()),
        }
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(&body);
}

/// Serves `root` on a local port; POSTs answer with a page titled by what was sent.
pub fn serve(root: PathBuf) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture server");
    let port = listener.local_addr().expect("address").port();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let root = root.clone();
            thread::spawn(move || respond(stream, &root));
        }
    });
    format!("http://127.0.0.1:{port}/")
}
