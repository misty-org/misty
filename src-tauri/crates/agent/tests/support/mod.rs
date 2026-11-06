//! A local server that records requests and gives one canned answer.
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[derive(Clone, Debug)]
pub struct Captured {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: Value,
}

pub struct MockServer {
    pub base_url: String,
    pub captured: Arc<Mutex<Vec<Captured>>>,
}

fn ends_at(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n").map(|at| at + 4)
}

/// Serves `body` with `status` to every connection, until the test ends.
pub async fn serve(status: u16, content_type: &str, body: String) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let captured = Arc::new(Mutex::new(Vec::new()));
    let log = captured.clone();
    let content_type = content_type.to_owned();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 8192];
            let head_end = loop {
                if let Some(end) = ends_at(&buffer) {
                    break end;
                }
                let read = socket.read(&mut chunk).await.unwrap();
                if read == 0 {
                    break buffer.len();
                }
                buffer.extend_from_slice(&chunk[..read]);
            };
            let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
            let mut lines = head.split("\r\n");
            let mut request_line = lines.next().unwrap_or_default().split(' ');
            let method = request_line.next().unwrap_or_default().to_owned();
            let path = request_line.next().unwrap_or_default().to_owned();
            let mut headers = BTreeMap::new();
            for line in lines {
                if let Some((name, value)) = line.split_once(':') {
                    headers.insert(name.trim().to_lowercase(), value.trim().to_owned());
                }
            }
            let length: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
            while buffer.len() < head_end + length {
                let read = socket.read(&mut chunk).await.unwrap();
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
            }
            let parsed = serde_json::from_slice(&buffer[head_end..]).unwrap_or(Value::Null);
            log.lock().unwrap().push(Captured { method, path, headers, body: parsed });
            let reply = format!(
                "HTTP/1.1 {status} Status\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(reply.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
    });
    MockServer { base_url, captured }
}
