use std::time::Duration;

use serde_json::json;
use tauri::ipc::InvokeResponseBody;

use super::*;

/// A channel that keeps what's sent on it, as the renderer would hear it.
fn listening() -> (Channel<SessionMessage>, mpsc::UnboundedReceiver<Value>) {
    let (send, heard) = mpsc::unbounded_channel();
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(text) = body {
            let _ = send.send(serde_json::from_str(&text).unwrap());
        }
        Ok(())
    });
    (channel, heard)
}

async fn next(heard: &mut mpsc::UnboundedReceiver<Value>) -> Value {
    tokio::time::timeout(Duration::from_secs(5), heard.recv())
        .await
        .unwrap()
        .unwrap()
}

/// A session that says back each message it reads, and ends when its way in closes.
fn echoing(owner: &str, channel: Channel<SessionMessage>) -> String {
    let (frames, mut reading) = Frames::text();
    open(owner, channel, frames, move |outgoing| {
        Box::pin(async move {
            let _ = outgoing.send(json!({ "type": "ready" }));
            while let Some(message) = reading.recv().await {
                let _ = outgoing.send(json!({ "said": message }));
            }
        })
    })
}

#[test]
fn messages_come_out_in_the_order_they_were_numbered() {
    let mut order = InOrder::default();
    assert_eq!(
        order.accept(1, b"b".to_vec()).unwrap(),
        Vec::<Vec<u8>>::new()
    );
    assert_eq!(
        order.accept(2, b"c".to_vec()).unwrap(),
        Vec::<Vec<u8>>::new()
    );
    assert_eq!(
        order.accept(0, b"a".to_vec()).unwrap(),
        [b"a".to_vec(), b"b".to_vec(), b"c".to_vec()]
    );
    // Repeated, so it's already been through.
    assert_eq!(
        order.accept(1, b"b".to_vec()).unwrap(),
        Vec::<Vec<u8>>::new()
    );
    assert_eq!(order.accept(3, b"d".to_vec()).unwrap(), [b"d".to_vec()]);
}

#[test]
fn a_message_that_never_comes_ends_it_rather_than_growing_forever() {
    let mut order = InOrder::default();
    for number in 1..=MAX_HELD as u64 {
        assert!(order.accept(number, Vec::new()).is_some());
    }
    assert!(order.accept(MAX_HELD as u64 + 1, Vec::new()).is_none());
}

#[tokio::test]
async fn a_session_keeps_the_renderers_order_and_says_when_it_closed() {
    let (channel, mut heard) = listening();
    let id = echoing("window-1", channel);
    assert_eq!(
        next(&mut heard).await["data"],
        json!({ "type": "ready" }).to_string()
    );
    deliver("window-1", &id, 1, b"second".to_vec())
        .await
        .unwrap();
    deliver("window-1", &id, 0, b"first".to_vec())
        .await
        .unwrap();
    assert_eq!(
        next(&mut heard).await["data"],
        json!({ "said": "first" }).to_string()
    );
    assert_eq!(
        next(&mut heard).await["data"],
        json!({ "said": "second" }).to_string()
    );
    close("window-1", &id).await.unwrap();
    assert_eq!(next(&mut heard).await["kind"], "closed");
    // Sending after the end is dropped, as a closed socket drops it.
    deliver("window-1", &id, 2, b"late".to_vec()).await.unwrap();
}

#[tokio::test]
async fn only_the_window_that_opened_it_can_use_it() {
    let (channel, mut heard) = listening();
    let id = echoing("window-1", channel);
    next(&mut heard).await;
    assert!(deliver("window-2", &id, 0, b"x".to_vec()).await.is_err());
    assert!(close("window-2", &id).await.is_err());
    close("window-1", &id).await.unwrap();
    assert_eq!(next(&mut heard).await["kind"], "closed");
}

#[tokio::test]
async fn a_panic_in_a_session_closes_that_session_and_nothing_else() {
    let (channel, mut heard) = listening();
    let (frames, _reading) = Frames::text();
    open("window-1", channel, frames, |outgoing| {
        Box::pin(async move {
            let _ = outgoing.send(json!({ "type": "ready" }));
            panic!("a voice turn went wrong");
        })
    });
    assert_eq!(next(&mut heard).await["kind"], "message");
    assert_eq!(next(&mut heard).await["kind"], "closed");

    let (channel, mut other) = listening();
    let id = echoing("window-1", channel);
    next(&mut other).await;
    deliver("window-1", &id, 0, b"still here".to_vec())
        .await
        .unwrap();
    assert_eq!(
        next(&mut other).await["data"],
        json!({ "said": "still here" }).to_string()
    );
    close("window-1", &id).await.unwrap();
}

#[tokio::test]
async fn a_reloaded_window_ends_its_sessions() {
    let (channel, mut heard) = listening();
    let id = echoing("window-7", channel);
    next(&mut heard).await;
    close_for_window("window-7");
    assert!(session_of(&id, "window-7").unwrap().is_none());
    assert_eq!(next(&mut heard).await["kind"], "closed");
}

#[tokio::test]
async fn a_renderer_that_stopped_listening_ends_it() {
    let (ended, mut told) = mpsc::unbounded_channel::<()>();
    let channel = Channel::new(move |_| {
        let _ = ended.send(());
        Err(tauri::Error::WebviewNotFound)
    });
    let id = echoing("window-8", channel);
    told.recv().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while session_of(&id, "window-8").unwrap().is_some() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn oversized_messages_are_refused() {
    let (channel, mut heard) = listening();
    let id = echoing("window-9", channel);
    next(&mut heard).await;
    assert!(deliver("window-9", &id, 0, vec![0; MAX_MESSAGE_BYTES + 1])
        .await
        .is_err());
    close("window-9", &id).await.unwrap();
}
