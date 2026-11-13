use std::sync::{Arc, Mutex};

use tokio::task::{spawn, yield_now};

use super::*;

async fn nothing() -> Result<(), RuntimeError> {
    Ok(())
}

async fn start(order: &SerialToolLifecycle, id: &str) -> Result<(), RuntimeError> {
    order.start(id, nothing, false).await
}

async fn finish(order: &SerialToolLifecycle, id: &str) {
    order.finish(id, nothing()).await.unwrap();
}

/// Lets spawned calls run as far as they can, as JavaScript's microtasks would.
async fn settle() {
    for _ in 0..16 {
        yield_now().await;
    }
}

#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<String>>>);

impl Events {
    fn push(&self, event: &str) {
        self.0.lock().unwrap().push(event.to_owned());
    }
    fn list(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
    /// A start checkpoint that records its call.
    fn step(&self, event: &str) -> impl FnOnce() -> futures_util::future::Ready<Result<(), RuntimeError>> + Send + 'static {
        let events = self.clone();
        let event = event.to_owned();
        move || {
            events.push(&event);
            futures_util::future::ready(Ok(()))
        }
    }
}

#[tokio::test]
async fn declines_the_rest_of_a_paused_response_and_resumes_for_the_next_model_turn() {
    let order = SerialToolLifecycle::new();
    start(&order, "stale-click").await.unwrap();
    let events = Events::default();
    let queued = spawn(order.start("dependent-write", events.step("dependent"), false));
    order.pause("A fresh observation is required before another action.");
    assert!(!order.resume());
    finish(&order, "stale-click").await;
    queued.await.unwrap().unwrap();
    assert!(events.list().is_empty());
    assert!(order.declined("dependent-write").unwrap().contains("tool_not_attempted"));
    finish(&order, "dependent-write").await;
    assert!(order.resume());
    start(&order, "fresh-inspection").await.unwrap();
    assert_eq!(order.declined("fresh-inspection"), None);
    finish(&order, "fresh-inspection").await;
}

#[tokio::test]
async fn never_recovers_when_the_rejection_checkpoint_itself_is_uncertain() {
    let order = SerialToolLifecycle::new();
    start(&order, "stale-click").await.unwrap();
    order.pause("A fresh observation is required before another action.");
    assert!(order.finish("stale-click", async { Err(RuntimeError::error("checkpoint failed")) }).await.is_err());
    assert!(!order.resume());
    start(&order, "next").await.unwrap();
    assert!(order.declined("next").unwrap().contains("tool_sequence_stopped"));
}

#[tokio::test]
async fn holds_later_tool_starts_behind_a_durable_approval_or_device_wait_and_its_end_checkpoint() {
    let order = SerialToolLifecycle::new();
    let events = Events::default();
    order.start("send", events.step("send:start"), false).await.unwrap();
    let later = spawn(order.start("note", events.step("note:start"), false));
    // Resuming a wait does not call finish; the resumed effect and its checkpoint
    // must settle first. A second tool cannot overwrite the first run's wait.
    settle().await;
    assert_eq!(events.list(), ["send:start"]);
    let ended = events.clone();
    order.finish("send", async move { ended.push("send:end"); Ok(()) }).await.unwrap();
    later.await.unwrap().unwrap();
    assert_eq!(events.list(), ["send:start", "send:end", "note:start"]);
    finish(&order, "note").await;
}

#[tokio::test]
async fn declines_queued_calls_with_a_stop_after_an_uncertain_effect_or_checkpoint_failure() {
    for checkpoint_fails in [false, true] {
        let order = SerialToolLifecycle::new();
        start(&order, "send").await.unwrap();
        let events = Events::default();
        let later = spawn(order.start("follow-up", events.step("follow-up"), false));
        if checkpoint_fails {
            let failed = order.finish("send", async { Err(RuntimeError::error("lost checkpoint response")) }).await;
            assert!(failed.unwrap_err().to_string().contains("lost checkpoint"));
        } else {
            order.stop("Delivery is uncertain");
            finish(&order, "send").await;
        }
        later.await.unwrap().unwrap();
        assert!(events.list().is_empty());
        assert!(order.declined("follow-up").unwrap().contains("tool_sequence_stopped"));
        finish(&order, "follow-up").await;
        assert!(!order.resume());
        start(&order, "next-model-turn").await.unwrap();
        assert!(order.declined("next-model-turn").unwrap().contains("tool_sequence_stopped"));
    }
}

#[tokio::test]
async fn rejects_duplicate_in_flight_identities_without_releasing_the_original_call() {
    let order = SerialToolLifecycle::new();
    start(&order, "send").await.unwrap();
    assert!(start(&order, "send").await.unwrap_err().to_string().contains("duplicate_tool_call_id"));
    let events = Events::default();
    let later = spawn(order.start("next", events.step("next"), false));
    settle().await;
    assert!(events.list().is_empty());
    finish(&order, "send").await;
    later.await.unwrap().unwrap();
    assert_eq!(events.list(), ["next"]);
    finish(&order, "next").await;
}

#[tokio::test]
async fn holds_queued_typing_after_a_dispatched_click_until_a_fresh_observation_turn() {
    let order = SerialToolLifecycle::new();
    let dispatched = Events::default();
    order.start("click", dispatched.step("click"), false).await.unwrap();
    let old_typing = spawn(order.start("type-old-frame", dispatched.step("wrong typing"), false));
    let pausing = order.clone();
    order.finish("click", async move { pausing.pause("A fresh screenshot is required before another action."); Ok(()) }).await.unwrap();
    old_typing.await.unwrap().unwrap();
    assert!(order.declined("type-old-frame").unwrap().contains("tool_not_attempted"));
    finish(&order, "type-old-frame").await;
    assert_eq!(dispatched.list(), ["click"]);
    assert!(order.resume());
    order.start("fresh-frame", dispatched.step("capture"), false).await.unwrap();
    finish(&order, "fresh-frame").await;
    order.start("type-fresh-frame", dispatched.step("type"), false).await.unwrap();
    finish(&order, "type-fresh-frame").await;
    assert_eq!(dispatched.list(), ["click", "capture", "type"]);
}

#[tokio::test]
async fn runs_concurrent_reads_together_after_earlier_writes_and_before_later_ones() {
    let order = SerialToolLifecycle::new();
    let events = Events::default();
    order.start("write-1", events.step("write-1:start"), false).await.unwrap();
    let read_a = spawn(order.start("read-a", events.step("read-a:start"), true));
    let read_b = spawn(order.start("read-b", events.step("read-b:start"), true));
    let write_2 = spawn(order.start("write-2", events.step("write-2:start"), false));
    settle().await;
    // Reads wait for the write before them.
    assert_eq!(events.list(), ["write-1:start"]);
    finish(&order, "write-1").await;
    read_a.await.unwrap().unwrap();
    read_b.await.unwrap().unwrap();
    assert_eq!(events.list(), ["write-1:start", "read-a:start", "read-b:start"]);
    // The next write waits for every read.
    finish(&order, "read-b").await;
    settle().await;
    assert!(!events.list().contains(&"write-2:start".to_owned()));
    finish(&order, "read-a").await;
    write_2.await.unwrap().unwrap();
    assert_eq!(events.list().last().map(String::as_str), Some("write-2:start"));
    finish(&order, "write-2").await;
}

#[tokio::test]
async fn declines_concurrent_reads_queued_behind_a_stopped_write() {
    let order = SerialToolLifecycle::new();
    start(&order, "send").await.unwrap();
    let read = spawn(order.start("read", nothing, true));
    order.stop("Delivery is uncertain");
    finish(&order, "send").await;
    read.await.unwrap().unwrap();
    assert!(order.declined("read").unwrap().contains("tool_sequence_stopped"));
    finish(&order, "read").await;
}

#[tokio::test]
async fn a_failed_start_checkpoint_stops_the_run_and_lets_the_line_move() {
    let order = SerialToolLifecycle::new();
    let failed = order.start("send", || async { Err(RuntimeError::error("lost")) }, false).await;
    assert!(failed.is_err());
    assert_eq!(order.stopped_reason(), "The preceding action or its checkpoint did not complete.");
    start(&order, "next").await.unwrap();
    assert!(order.declined("next").unwrap().contains("tool_sequence_stopped"));
}
