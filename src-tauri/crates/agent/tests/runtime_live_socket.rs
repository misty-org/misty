//! A live session over a real socket to a local stand-in for Soniox, through the channels the app
//! connects to the renderer.
use std::{sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use misty_agent::runtime::live::{run_live_session, LiveChannel, LiveSessionSpec, SonioxFactory};
use serde_json::{json, Value};
use tokio::{net::TcpListener, sync::mpsc};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{Request, Response},
        Message,
    },
};

fn spec(channels: Vec<LiveChannel>) -> LiveSessionSpec {
    LiveSessionSpec { sid: "s1".to_owned(), channels, max_ms: 60_000, language: None, model: "soniox/stt-rt-v5".to_owned() }
}

const KEY: &str = "soniox-device-secret-key";

/// Serves one socket: records what arrives and runs `script` on it.
async fn stand_in<F, Fut>(script: F) -> String
where
    F: FnOnce(tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/transcribe-websocket", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let socket = accept_hdr_async(socket, |request: &Request, response: Response| {
            assert_eq!(request.headers().get("authorization").unwrap().to_str().unwrap(), format!("Bearer {KEY}"));
            assert_eq!(request.uri().path(), "/transcribe-websocket");
            Ok(response)
        })
        .await
        .unwrap();
        script(socket).await;
    });
    url
}

async fn next_message(receiver: &mut mpsc::UnboundedReceiver<Value>) -> Value {
    tokio::time::timeout(Duration::from_secs(10), receiver.recv()).await.unwrap().unwrap()
}

#[tokio::test]
async fn a_session_runs_from_start_to_finished() {
    let url = stand_in(|mut socket| async move {
        let config = socket.next().await.unwrap().unwrap().into_text().unwrap();
        // The fields go in the order `buildConfigMessage` writes them.
        assert_eq!(
            config.as_str(),
            r#"{"model":"stt-rt-v5","audio_format":"pcm_s16le","sample_rate":16000,"num_channels":1,"language_hints":["en"],"enable_speaker_diarization":true,"enable_language_identification":true,"enable_endpoint_detection":true}"#
        );
        let audio = socket.next().await.unwrap().unwrap();
        assert_eq!(audio, Message::binary(vec![9u8; 64]));
        let tokens = json!({ "tokens": [
            { "text": "Hi", "start_ms": 10, "end_ms": 20, "is_final": true, "speaker": "1" },
            { "text": " the", "start_ms": 20, "end_ms": 30, "is_final": false, "speaker": "1" },
        ], "total_audio_proc_ms": 30 });
        socket.send(Message::text(tokens.to_string())).await.unwrap();
        socket.send(Message::text(json!({ "tokens": [{ "text": "<end>", "is_final": true }], "total_audio_proc_ms": 40 }).to_string())).await.unwrap();
        // An empty text frame ends the audio.
        let end = socket.next().await.unwrap().unwrap();
        assert_eq!(end, Message::text(""));
        socket.send(Message::text(json!({ "tokens": [], "finished": true }).to_string())).await.unwrap();
    })
    .await;
    let (to_session, incoming) = mpsc::channel(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = tokio::spawn(run_live_session(spec(vec![LiveChannel::Mic]), Arc::new(SonioxFactory::at(&url, KEY)), incoming, sender));
    to_session.send(json!({ "type": "start", "language": "en" }).to_string().into_bytes()).await.unwrap();
    assert_eq!(next_message(&mut receiver).await, json!({ "type": "ready", "channels": ["mic"], "maxMs": 60_000 }));
    let mut frame = vec![0u8];
    frame.extend(vec![9u8; 64]);
    to_session.send(frame).await.unwrap();
    let draft = next_message(&mut receiver).await;
    assert_eq!(draft["type"], "segment");
    assert_eq!(draft["segment"]["id"], "s1:mic:soniox-0");
    assert_eq!(draft["segment"]["sourceText"], "Hi the");
    assert_eq!(draft["segment"]["final"], false);
    // The endpoint's result is empty and so revises the draft away, then closes it with what's final.
    let empty = next_message(&mut receiver).await;
    assert_eq!(empty["segment"]["sourceText"], "Hi");
    let closed = next_message(&mut receiver).await;
    assert_eq!(closed["segment"]["final"], true);
    assert_eq!(closed["segment"]["state"], "complete");
    assert_eq!(closed["segment"]["words"], json!([{ "text": "Hi", "t0": 10, "t1": 20, "speaker": "1" }]));
    to_session.send(json!({ "type": "finish" }).to_string().into_bytes()).await.unwrap();
    assert_eq!(next_message(&mut receiver).await, json!({ "type": "finished", "usedMs": 2 }));
    tokio::time::timeout(Duration::from_secs(5), session).await.unwrap().unwrap();
}

#[tokio::test]
async fn an_error_from_the_provider_says_only_that_it_stopped() {
    let url = stand_in(|mut socket| async move {
        socket.next().await;
        let failure = json!({ "error_code": 401, "error_message": format!("bad key {KEY}") });
        socket.send(Message::text(failure.to_string())).await.unwrap();
        // The stream closes the socket after a failure.
        while let Some(Ok(message)) = socket.next().await {
            if message.is_close() {
                break;
            }
        }
    })
    .await;
    let (to_session, incoming) = mpsc::channel(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = tokio::spawn(run_live_session(spec(vec![LiveChannel::Mic]), Arc::new(SonioxFactory::at(&url, KEY)), incoming, sender));
    to_session.send(json!({ "type": "start" }).to_string().into_bytes()).await.unwrap();
    assert_eq!(next_message(&mut receiver).await["type"], "ready");
    let failed = next_message(&mut receiver).await;
    assert_eq!(failed, json!({ "type": "error", "message": "Live transcription stopped. Check your connection and try again." }));
    assert!(!failed.to_string().contains(KEY));
    drop(to_session);
    tokio::time::timeout(Duration::from_secs(5), session).await.unwrap().unwrap();
}

#[tokio::test]
async fn a_socket_lost_during_finish_still_flushes_and_ends() {
    let url = stand_in(|mut socket| async move {
        socket.next().await;
        socket.send(Message::text(json!({ "tokens": [{ "text": "Kept", "is_final": true, "speaker": "1" }] }).to_string())).await.unwrap();
        socket.next().await;
    })
    .await;
    let (to_session, incoming) = mpsc::channel(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = tokio::spawn(run_live_session(spec(vec![LiveChannel::System]), Arc::new(SonioxFactory::at(&url, KEY)), incoming, sender));
    to_session.send(json!({ "type": "start" }).to_string().into_bytes()).await.unwrap();
    assert_eq!(next_message(&mut receiver).await["type"], "ready");
    assert_eq!(next_message(&mut receiver).await["segment"]["sourceText"], "Kept");
    to_session.send(json!({ "type": "finish" }).to_string().into_bytes()).await.unwrap();
    let closed = next_message(&mut receiver).await;
    assert_eq!(closed["segment"]["final"], true);
    assert_eq!(closed["segment"]["sourceText"], "Kept");
    assert_eq!(next_message(&mut receiver).await, json!({ "type": "finished", "usedMs": 0 }));
    tokio::time::timeout(Duration::from_secs(5), session).await.unwrap().unwrap();
}

#[tokio::test]
async fn a_server_that_cannot_be_reached_says_it_couldnt_start() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/", listener.local_addr().unwrap());
    drop(listener);
    let (to_session, incoming) = mpsc::channel(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = tokio::spawn(run_live_session(spec(vec![LiveChannel::Mic]), Arc::new(SonioxFactory::at(&url, KEY)), incoming, sender));
    to_session.send(json!({ "type": "start" }).to_string().into_bytes()).await.unwrap();
    assert_eq!(next_message(&mut receiver).await, json!({ "type": "error", "message": "Live transcription couldn't start. Try again in a moment." }));
    drop(to_session);
    tokio::time::timeout(Duration::from_secs(5), session).await.unwrap().unwrap();
}

#[tokio::test]
async fn closing_the_channel_closes_the_socket_without_waiting() {
    let (closed_tx, closed_rx) = tokio::sync::oneshot::channel();
    let url = stand_in(|mut socket| async move {
        socket.next().await;
        let mut closed = false;
        while let Some(Ok(message)) = socket.next().await {
            closed = closed || message.is_close();
        }
        let _ = closed_tx.send(closed);
    })
    .await;
    let (to_session, incoming) = mpsc::channel(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = tokio::spawn(run_live_session(spec(vec![LiveChannel::Mic]), Arc::new(SonioxFactory::at(&url, KEY)), incoming, sender));
    to_session.send(json!({ "type": "start" }).to_string().into_bytes()).await.unwrap();
    assert_eq!(next_message(&mut receiver).await["type"], "ready");
    drop(to_session);
    tokio::time::timeout(Duration::from_secs(5), session).await.unwrap().unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(5), closed_rx).await.unwrap().unwrap());
}
