//! What a session does when things happen at once, and what the route enforced.
use std::{sync::Arc, time::Duration};

use serde_json::{json, Value};
use tokio::sync::{
    mpsc::{self, UnboundedReceiver},
    Notify,
};

use super::{
    route::{run, SESSION},
    session_tests::{drain, models, types, FakeModels},
};

fn held() -> FakeModels {
    let mut fake = models(&[("Too late.", "", "")]);
    fake.hold = Some(Arc::new(Notify::new()));
    fake
}

async fn wait_for(receiver: &mut UnboundedReceiver<Value>, sent: &mut Vec<Value>, kind: &str) {
    loop {
        if sent.iter().any(|message| message["type"] == kind) {
            return;
        }
        let message = tokio::time::timeout(Duration::from_secs(5), receiver.recv()).await.unwrap().unwrap();
        sent.push(message);
    }
}

/// Cancelling aborts the model call, and the aborted call then reports the session stopped, which is
/// what the TypeScript's abort signal did: `turn.done` first, then `error`.
#[tokio::test]
async fn a_cancel_during_a_model_call_aborts_it() {
    let fake = held();
    let (to_session, incoming) = mpsc::channel(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let running = run("abc", &fake, incoming, sender, Duration::from_secs(60));
    let driver = async {
        for message in [json!({ "type": "turn.begin" }), json!({ "type": "text.commit", "text": "go" })] {
            to_session.send(message.to_string()).await.unwrap();
        }
        let mut sent = Vec::new();
        wait_for(&mut receiver, &mut sent, "transcript").await;
        to_session.send(json!({ "type": "turn.cancel" }).to_string()).await.unwrap();
        wait_for(&mut receiver, &mut sent, "error").await;
        assert_eq!(types(&sent), ["ready", "turn.ready", "transcript", "turn.done", "error"]);
        assert_eq!(*fake.cancelled.lock().unwrap(), 1);
        drop(to_session);
    };
    tokio::join!(running, driver);
}

/// Playback ending doesn't abort anything: the call finishes, and its turn says nothing more.
#[tokio::test]
async fn a_call_that_outlives_its_turn_says_nothing() {
    let fake = held();
    let hold = fake.hold.clone().unwrap();
    let (to_session, incoming) = mpsc::channel(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let running = run("abc", &fake, incoming, sender, Duration::from_secs(60));
    let driver = async {
        for message in [json!({ "type": "turn.begin" }), json!({ "type": "text.commit", "text": "go" })] {
            to_session.send(message.to_string()).await.unwrap();
        }
        let mut sent = Vec::new();
        wait_for(&mut receiver, &mut sent, "transcript").await;
        to_session.send(json!({ "type": "playback.done" }).to_string()).await.unwrap();
        wait_for(&mut receiver, &mut sent, "turn.done").await;
        hold.notify_one();
        to_session.send(json!({ "type": "ping" }).to_string()).await.unwrap();
        wait_for(&mut receiver, &mut sent, "pong").await;
        assert_eq!(types(&sent), ["ready", "turn.ready", "transcript", "turn.done", "pong"]);
        drop(to_session);
    };
    tokio::join!(running, driver);
}

#[tokio::test]
async fn the_session_skips_what_it_cant_read_and_closes_with_the_app() {
    let fake = models(&[]);
    let (to_session, incoming) = mpsc::channel(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    to_session.send("not json".to_owned()).await.unwrap();
    to_session.send(format!("\"{}\"", "x".repeat(200_001))).await.unwrap();
    to_session.send(json!({ "type": "ping" }).to_string()).await.unwrap();
    drop(to_session);
    run("abc", &fake, incoming, sender, Duration::from_secs(60)).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert_eq!(types(&sent), ["ready", "pong"]);
}

#[tokio::test(start_paused = true)]
async fn the_session_expires_after_five_minutes() {
    let fake = models(&[]);
    let (_to_session, incoming) = mpsc::channel::<String>(8);
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let started = tokio::time::Instant::now();
    run("abc", &fake, incoming, sender, SESSION).await;
    assert_eq!(started.elapsed(), Duration::from_secs(300));
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert_eq!(types(&sent), ["ready", "session.expired"]);
}
