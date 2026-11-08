//! A local server that records requests and gives canned answers.
// Each test file uses a different part of this.
#![allow(dead_code)]

pub mod run_backend;

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::STANDARD, Engine};
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

/// One canned answer.
#[derive(Clone, Debug)]
pub struct Reply {
    pub status: u16,
    pub content_type: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn new(status: u16, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        Self { status, content_type: content_type.to_owned(), headers: Vec::new(), body: body.into() }
    }

    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }
}

/// Serves `body` with `status` to every connection, until the test ends.
pub async fn serve(status: u16, content_type: &str, body: String) -> MockServer {
    serve_replies(vec![Reply::new(status, content_type, body)]).await
}

/// What a request body reads as: JSON, a multipart form with its random boundary gone, or base64.
fn parsed_body(headers: &BTreeMap<String, String>, raw: &[u8]) -> Value {
    if raw.is_empty() {
        return Value::Null;
    }
    let content_type = headers.get("content-type").map_or("", String::as_str);
    if let Some(boundary) = content_type.split("boundary=").nth(1) {
        return multipart_fields(raw, boundary.trim_matches('"'));
    }
    serde_json::from_slice(raw).unwrap_or_else(|_| Value::String(STANDARD.encode(raw)))
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack[from..].windows(needle.len()).position(|window| window == needle).map(|at| at + from)
}

fn quoted_value(line: &str, name: &str) -> Option<String> {
    let start = line.find(&format!("{name}=\"")).map(|at| at + name.len() + 2)?;
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_owned())
}

/// Each field in order, with its contents in base64 so audio survives.
fn multipart_fields(raw: &[u8], boundary: &str) -> Value {
    let marker = format!("--{boundary}");
    let mut fields = Vec::new();
    let mut at = find(raw, marker.as_bytes(), 0).map(|at| at + marker.len());
    while let Some(start) = at {
        if raw[start..].starts_with(b"--") {
            break;
        }
        let Some(head_end) = find(raw, b"\r\n\r\n", start) else {
            break;
        };
        let head = String::from_utf8_lossy(&raw[start..head_end]).to_string();
        let body_start = head_end + 4;
        let closing = format!("\r\n--{boundary}");
        let Some(body_end) = find(raw, closing.as_bytes(), body_start) else {
            break;
        };
        let disposition = head.lines().find(|line| line.to_lowercase().starts_with("content-disposition")).unwrap_or("");
        let field_type = head
            .lines()
            .find(|line| line.to_lowercase().starts_with("content-type"))
            .and_then(|line| line.split_once(':'))
            .map(|(_, value)| value.trim().to_owned());
        fields.push(serde_json::json!({
            "name": quoted_value(disposition, "name"),
            "filename": quoted_value(disposition, "filename"),
            "contentType": field_type,
            "base64": STANDARD.encode(&raw[body_start..body_end]),
        }));
        at = Some(body_end + closing.len());
    }
    serde_json::json!({ "multipart": fields })
}

/// Serves the replies in order, repeating the last one for any further request, until the test ends.
pub async fn serve_replies(replies: Vec<Reply>) -> MockServer {
    assert!(!replies.is_empty(), "a mock server needs a reply");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let captured = Arc::new(Mutex::new(Vec::new()));
    let log = captured.clone();
    tokio::spawn(async move {
        let mut served = 0;
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
            let parsed = parsed_body(&headers, &buffer[head_end..]);
            log.lock().unwrap().push(Captured { method, path, headers, body: parsed });
            let reply = &replies[served.min(replies.len() - 1)];
            served += 1;
            let extra: String = reply.headers.iter().map(|(name, value)| format!("{name}: {value}\r\n")).collect();
            let head = format!(
                "HTTP/1.1 {} Status\r\ncontent-type: {}\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n",
                reply.status,
                reply.content_type,
                reply.body.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(&reply.body).await;
            let _ = socket.shutdown().await;
        }
    });
    MockServer { base_url, captured }
}

/// Answers each request from `handler`, each on its own task, until the test ends. A handler may take
/// as long as it likes: a client that gives up just drops the connection.
pub async fn serve_fn<F, Fut>(handler: F) -> String
where
    F: Fn(Captured) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Reply> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let handler = Arc::new(handler);
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let handler = handler.clone();
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 8192];
                let head_end = loop {
                    if let Some(end) = ends_at(&buffer) {
                        break end;
                    }
                    let Ok(read) = socket.read(&mut chunk).await else { return };
                    if read == 0 {
                        return;
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
                    let Ok(read) = socket.read(&mut chunk).await else { return };
                    if read == 0 {
                        return;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                }
                let body = parsed_body(&headers, &buffer[head_end..]);
                let reply = handler(Captured { method, path, headers, body }).await;
                let head = format!(
                    "HTTP/1.1 {} Status\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    reply.status,
                    reply.content_type,
                    reply.body.len()
                );
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(&reply.body).await;
                let _ = socket.shutdown().await;
            });
        }
    });
    base_url
}
