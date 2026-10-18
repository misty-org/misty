//! The driver against mock servers: OpenCode's SSE and DeepSeek Shell's
//! WebSocket, with a permission question answered through the bridge.
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{body::Body, extract::Request, routing::any, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::{net::TcpListener, sync::Notify};
use tokio_tungstenite::tungstenite::Message;

use super::{
    super::{
        bridge::BridgeContext,
        events::{PermissionRequest, RunnerEvent},
        lease::{Lease, LeaseMeter},
        session::{BoxFuture, Outcome, SessionHost},
        LaunchMode,
    },
    driver::{drive, Connection},
    dsh::DshProtocol,
    opencode::OpencodeProtocol,
    tests::launch,
    StreamKind,
};

#[derive(Default)]
struct Host {
    asked: Mutex<Vec<String>>,
    events: Mutex<Vec<RunnerEvent>>,
}

impl SessionHost for Host {
    fn emit<'a>(&'a self, events: Vec<RunnerEvent>) -> BoxFuture<'a, ()> {
        self.events.lock().unwrap().extend(events);
        Box::pin(async {})
    }
    fn ask<'a>(
        &'a self,
        request: &'a PermissionRequest,
        action: &'static str,
    ) -> BoxFuture<'a, bool> {
        self.asked
            .lock()
            .unwrap()
            .push(format!("{action}:{}", request.id));
        Box::pin(async { true })
    }
    fn now(&self) -> i64 {
        10
    }
}

fn meter() -> LeaseMeter {
    LeaseMeter::new(Lease {
        invocation_id: "run".into(),
        token_budget: 1_000,
        expires_at: 100,
        grant_version: 1,
        grants: vec![],
        signature: "s".into(),
    })
}

fn context(mode: &str) -> BridgeContext {
    BridgeContext {
        mode: mode.into(),
        plan: false,
        project_root: PathBuf::from("/work/app"),
        grants: vec![],
        lease_valid: true,
    }
}

type Posts = Arc<Mutex<Vec<(String, Value)>>>;

async fn serve(router: Router) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    origin
}

fn client() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn opencode_turn_over_sse_answers_through_the_bridge() {
    let posts: Posts = Arc::default();
    let answered = Arc::new(Notify::new());
    let (record, notify) = (posts.clone(), answered.clone());
    let router = Router::new().fallback(any(move |request: Request| {
        let (record, notify) = (record.clone(), notify.clone());
        async move {
            let path = request.uri().path().to_owned();
            if path == "/event" {
                let frames = async_stream::stream! {
                    let frame = |value: Value| Ok::<_, std::io::Error>(format!("data: {value}\n\n"));
                    let mine = |kind: &str, mut properties: Value| { properties["sessionID"] = json!("ses_1"); json!({ "type": kind, "properties": properties }) };
                    yield frame(mine("session.status", json!({ "status": { "type": "busy" } })));
                    yield frame(mine("permission.asked", json!({ "id": "per_1", "permission": "edit", "patterns": ["src/main.rs"] })));
                    notify.notified().await;
                    yield frame(mine("message.part.delta", json!({ "partID": "p", "delta": "Fixed." })));
                    yield frame(json!({ "type": "message.updated", "properties": { "info": { "id": "m", "sessionID": "ses_1", "role": "assistant",
                        "time": { "completed": 1 }, "tokens": { "input": 20, "output": 5, "cache": { "read": 0, "write": 0 } } } } }));
                    yield frame(mine("session.status", json!({ "status": { "type": "idle" } })));
                };
                return Body::from_stream(frames).into_response_body();
            }
            let bytes = axum::body::to_bytes(request.into_body(), 1 << 20).await.unwrap();
            record.lock().unwrap().push((path.clone(), serde_json::from_slice(&bytes).unwrap_or(Value::Null)));
            if path.starts_with("/permission/") {
                notify.notify_one();
            }
            Body::from(if path == "/session" { r#"{"id":"ses_1"}"# } else { "{}" }).into_response_body()
        }
    }));
    let origin = serve(router).await;
    let host = Host::default();
    let (_stop, stop) = tokio::sync::oneshot::channel();
    let connection = Connection::new(client(), &origin, None, StreamKind::Sse);
    let protocol = Box::new(OpencodeProtocol::new(&launch(LaunchMode::Ask, &[])));
    let outcome = drive(
        connection,
        protocol,
        context("ask"),
        &mut meter(),
        &host,
        stop,
    )
    .await;
    assert_eq!(outcome, Outcome::Finished);
    assert_eq!(
        host.asked.lock().unwrap().len(),
        1,
        "Ask asks the person before the edit"
    );
    let posts = posts.lock().unwrap();
    let reply = posts
        .iter()
        .find(|(path, _)| path == "/permission/per_1/reply")
        .expect("answered");
    assert_eq!(reply.1, json!({ "reply": "once" }));
    assert!(posts
        .iter()
        .any(|(path, _)| path == "/session/ses_1/prompt_async"));
    let events = host.events.lock().unwrap();
    assert!(events
        .iter()
        .any(|event| matches!(event, RunnerEvent::Usage(usage) if usage.input == 20)));
}

#[tokio::test]
async fn deepseek_shell_turn_over_a_websocket() {
    let posts: Posts = Arc::default();
    let prompted = Arc::new(Notify::new());
    let answered = Arc::new(Notify::new());
    let (record, on_prompt, on_answer) = (posts.clone(), prompted.clone(), answered.clone());
    let router = Router::new().fallback(any(move |request: Request| {
        let (record, on_prompt, on_answer) = (record.clone(), on_prompt.clone(), on_answer.clone());
        async move {
            let path = request.uri().path().to_owned();
            let bytes = axum::body::to_bytes(request.into_body(), 1 << 20)
                .await
                .unwrap();
            record.lock().unwrap().push((
                path.clone(),
                serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            ));
            let value = match path.as_str() {
                "/api/workspace/create" => json!({ "workspaceId": "w1" }),
                "/api/session/create" => json!({ "sessionId": "s1" }),
                "/api/session/prompt" => {
                    on_prompt.notify_one();
                    json!({})
                }
                "/api/$events/result" => {
                    on_answer.notify_one();
                    json!(null)
                }
                _ => json!(null),
            };
            Body::from(
                json!({ "type": "server-response", "result": { "ok": true, "value": value } })
                    .to_string(),
            )
            .into_response_body()
        }
    }));
    let origin = serve(router).await;
    let sockets = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_origin = format!("ws://{}", sockets.local_addr().unwrap());
    tokio::spawn(async move {
        let (stream, _) = sockets.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        for _ in 0..2 {
            socket.next().await.unwrap().unwrap();
        }
        let send = |stream: &str, value: Value| {
            Message::text(json!({ "type": "item", "streamId": stream, "value": value }).to_string())
        };
        socket
            .send(send("events", json!({ "type": "ready", "clientId": "c1" })))
            .await
            .unwrap();
        socket
            .send(send("follow", json!({ "type": "snapshot" })))
            .await
            .unwrap();
        prompted.notified().await;
        socket
            .send(send(
                "events",
                json!({ "type": "waterfall", "event": "approval/request", "eventId": "e1",
            "request": { "tool": "shell", "command": "cargo test" } }),
            ))
            .await
            .unwrap();
        answered.notified().await;
        socket
            .send(send(
                "follow",
                json!({ "type": "assistant-stream", "frame": { "type": "chunk",
            "chunk": { "type": "usage", "usage": { "inputTokens": 9, "outputTokens": 1 } } } }),
            ))
            .await
            .unwrap();
        socket.send(send("follow", json!({ "type": "event", "event": { "type": "turn/end", "data": { "reason": { "kind": "completed" } } } }))).await.unwrap();
        let _ = socket.next().await;
    });
    let host = Host::default();
    let (_stop, stop) = tokio::sync::oneshot::channel();
    let mut connection = Connection::new(
        client(),
        &origin,
        Some("dsh-auth=1".into()),
        StreamKind::WebSocket,
    );
    connection.ws_origin = ws_origin;
    let protocol = Box::new(DshProtocol::new(&launch(LaunchMode::AutoEdit, &[])));
    let outcome = drive(
        connection,
        protocol,
        context("auto"),
        &mut meter(),
        &host,
        stop,
    )
    .await;
    assert_eq!(outcome, Outcome::Finished);
    assert!(
        host.asked.lock().unwrap().is_empty(),
        "running a command in the project continues in Auto"
    );
    let posts = posts.lock().unwrap();
    let result = posts
        .iter()
        .find(|(path, _)| path == "/api/$events/result")
        .expect("answered");
    assert_eq!(
        result.1["payload"]["args"]["outcome"]["value"],
        "allowed-once"
    );
}

trait IntoResponseBody {
    fn into_response_body(self) -> axum::response::Response;
}

impl IntoResponseBody for Body {
    fn into_response_body(self) -> axum::response::Response {
        axum::response::Response::new(self)
    }
}
