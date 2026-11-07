//! Waiting, restarting and resuming: a run saved at any of its stages continues with the same meaning.
use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

use serde_json::json;

use crate::runtime::{
    js_json::JsValue,
    person_takeover::RESUME_NOTE,
    runtime_errors::{ControlPlaneError, RuntimeError},
    tool_execution::ToolExecutionResponse,
};

use super::{
    loop_tests::*,
    space_task_agent::run_space_task_agent,
    state::Stage,
    store::{LoadedRun, StoredRun},
    workflow_tests::{field, finished, then_finish},
};

fn saved(harness: &Harness) -> Option<StoredRun> {
    match harness.store.load_all().ok()?.pop()? {
        LoadedRun::Ready(stored) => Some(*stored),
        LoadedRun::Unreadable(_) => None,
    }
}

#[tokio::test]
async fn a_device_wait_holds_the_call_until_the_device_answers_with_the_same_identity() {
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Open it", "allowed_tools": ["browser.steps"] }).to_string());
    *harness.gateway.catalog.lock().unwrap() = vec![tool("browser.steps")];
    let asks = AtomicUsize::new(0);
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |_, _| {
        if asks.fetch_add(1, Ordering::SeqCst) == 0 {
            ToolExecutionResponse { device_wait: Some(JsValue::Bool(true)), ..ToolExecutionResponse::default() }
        } else {
            ToolExecutionResponse::result(json(r#"{"ok":true}"#))
        }
    }));
    harness.script(vec![calling(vec![call("c1", "browser_steps", "{}")])]);
    then_finish(&harness);
    let hooks = harness.hooks.clone();
    let token = "misty-device:run-fixture:c1:wait:0";
    let wake = tokio::spawn(async move {
        loop {
            if hooks.resume(token, true, |_| false) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    });
    harness.run().await.unwrap();
    wake.await.unwrap();
    let executed = harness.gateway.executed.lock().unwrap();
    let tokens: Vec<&str> = executed.iter().map(|call| call.3.as_str()).collect();
    assert_eq!(tokens, ["misty-device:run-fixture:c1:wait:0", "misty-device:run-fixture:c1:wait:1"]);
    assert!(executed.iter().all(|call| call.0 == "c1"));
}

#[tokio::test]
async fn a_device_wait_survives_a_restart_on_the_same_token() {
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Open it", "allowed_tools": ["browser.steps"] }).to_string());
    *harness.gateway.catalog.lock().unwrap() = vec![tool("browser.steps")];
    let asks = AtomicUsize::new(0);
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |_, _| {
        if asks.fetch_add(1, Ordering::SeqCst) == 0 {
            ToolExecutionResponse { device_wait: Some(JsValue::Bool(true)), ..ToolExecutionResponse::default() }
        } else {
            ToolExecutionResponse::result(json(r#"{"ok":true}"#))
        }
    }));
    harness.script(vec![calling(vec![call("c1", "browser_steps", "{}")])]);
    then_finish(&harness);
    let token = "misty-device:run-fixture:c1:wait:0";

    // The run reaches the wait, and its file says so.
    let first = tokio::spawn(run_space_task_agent(harness.deps(), harness.stored()));
    let mut stored = None;
    for _ in 0..2000 {
        stored = saved(&harness).filter(|run| run.state.as_ref().is_some_and(|state| serde_json::to_string(state).unwrap().contains("\"waits\":{\"c1\"")));
        if stored.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let stored = stored.expect("the file says the call is waiting");
    first.abort();
    let _ = first.await;
    harness.hooks.forget_run("run-fixture");

    // Misty opens again. Only the run's own token wakes it, and it asks again as the wait's next attempt.
    let hooks = harness.hooks.clone();
    let resumed = tokio::spawn(run_space_task_agent(harness.deps(), stored));
    assert!(!hooks.resume("misty-device:someone-else:c1:wait:0", true, |_| false));
    let mut woken = false;
    for _ in 0..2000 {
        woken = hooks.resume(token, true, |_| false);
        if woken {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(woken, "the resumed run waits on the same token");
    resumed.await.unwrap().unwrap();
    let tokens: Vec<String> = harness.gateway.executed.lock().unwrap().iter().map(|(.., token)| token.clone()).collect();
    assert_eq!(tokens, [token.to_owned(), "misty-device:run-fixture:c1:wait:1".to_owned()], "no second request for the wait it was in");
}

#[tokio::test(start_paused = true)]
async fn a_provider_outage_is_waited_out_without_spending_the_runs_time() {
    let harness = Harness::new(&plain_context("Say it"));
    harness.script(vec![Turn::Fails("Internal Server Error".to_owned()), Turn::Fails("Internal Server Error".to_owned()), Turn::Fails("Internal Server Error".to_owned()), Turn::Fails("Internal Server Error".to_owned()), answer("Said.")]);
    harness.run().await.unwrap();
    let logged = harness.logged.lock().unwrap();
    let line = logged.iter().find(|line| line.contains("provider_outage")).unwrap();
    assert!(line.contains(r#""wait":"30s""#), "{line}");
    drop(logged);
    assert_eq!(field(&harness.control.completions()[0], "status"), "success");
}

#[tokio::test]
async fn a_resumed_run_continues_from_its_file_and_runs_no_finished_tool_again() {
    // First process: stops while the model is on its second call.
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Do both", "allowed_tools": ["task.write"] }).to_string());
    *harness.gateway.catalog.lock().unwrap() = vec![tool("task.write")];
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(|_, _| ToolExecutionResponse::result(json(r#"{"ok":true}"#))));
    harness.script(vec![calling(vec![call("one", "task_write", "{}"), call("two", "task_write", "{}")])]);
    *harness.models.after.lock().unwrap() = Some(Turn::Hangs);
    let first = tokio::spawn(run_space_task_agent(harness.deps(), harness.stored()));
    while harness.models.calls.lock().unwrap().len() < 2 {
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    first.abort();
    let _ = first.await;
    let saved = harness.store.load_all().unwrap();
    let [LoadedRun::Ready(stored)] = saved.as_slice() else {
        panic!("the run's file is there");
    };
    let stored = (**stored).clone();
    let state = stored.state.as_ref().unwrap();
    assert_eq!(state.model_turn, 1);
    assert_eq!(harness.gateway.executed.lock().unwrap().len(), 2);
    // Second process, same folder: continues on its next turn with no tool run twice.
    harness.script(vec![finished()]);
    *harness.models.after.lock().unwrap() = None;
    let ended = run_space_task_agent(harness.deps(), stored).await.unwrap();
    assert_eq!(ended.steps, 2);
    assert_eq!(harness.gateway.executed.lock().unwrap().len(), 2);
    assert!(harness.prompt_json(2).contains("task_write"));
    assert_eq!(field(&harness.control.completions()[0], "status"), "success");
}

#[tokio::test]
async fn a_run_stopped_in_the_middle_of_a_turn_runs_the_unfinished_calls_with_the_same_ids() {
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Do both", "allowed_tools": ["task.write"] }).to_string());
    *harness.gateway.catalog.lock().unwrap() = vec![tool("task.write")];
    // Calls run one at a time, and the second doesn't come back before the "crash".
    harness.gateway.hang_on.lock().unwrap().push("two".to_owned());
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(|id, _| ToolExecutionResponse::result(json(&format!(r#"{{"done":"{id}"}}"#)))));
    harness.script(vec![calling(vec![call("one", "task_write", "{}"), call("two", "task_write", "{}")])]);
    let first = tokio::spawn(run_space_task_agent(harness.deps(), harness.stored()));
    let finished_one = || {
        let Ok(mut runs) = harness.store.load_all() else { return None };
        let Some(LoadedRun::Ready(stored)) = runs.pop() else { return None };
        let state = stored.state.clone()?;
        match state.stage {
            Stage::Tools(turn) if turn.finished.contains_key("one") => Some(*stored),
            _ => None,
        }
    };
    let stored = loop {
        let second_began = harness.gateway.executed.lock().unwrap().iter().any(|call| call.0 == "two");
        if let Some(stored) = finished_one().filter(|_| second_began) {
            break stored;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    };
    first.abort();
    let _ = first.await;
    // A new process over the same file. The server journals by ID, so "two" runs again as itself and "one" doesn't.
    harness.script(vec![finished()]);
    let ended = run_space_task_agent(harness.deps(), stored).await.unwrap();
    assert!(!ended.incomplete);
    let executed: Vec<String> = harness.gateway.executed.lock().unwrap().iter().map(|call| call.0.clone()).collect();
    assert_eq!(executed, ["one", "two", "two"]);
    let results = harness.prompt_json(1);
    assert!(results.contains(r#"\"done\":\"one\""#), "{results}");
    assert!(results.contains(r#"\"done\":\"two\""#), "{results}");
}

#[tokio::test]
async fn usage_limit_mid_task_keeps_what_was_done() {
    let harness = Harness::new(&plain_context("Do it"));
    harness.script(vec![calling(vec![])]);
    let reads = AtomicUsize::new(0);
    *harness.control.intercept.lock().unwrap() = Some(Box::new(move |action, _| {
        (action == "budget" && reads.fetch_add(1, Ordering::SeqCst) >= 1).then(|| Err(RuntimeError::from(ControlPlaneError::new(429, "usage_limit_reached: Rate limited.", Some("usage_limit_reached")))))
    }));
    let ended = harness.run().await.unwrap();
    assert!(ended.incomplete);
    let completions = harness.control.completions();
    assert_eq!(field(&completions[0], "status"), "incomplete");
    assert_eq!(field(&completions[0], "error_code"), "usage_limit_reached");
}

#[tokio::test(start_paused = true)]
async fn an_outages_wait_survives_a_restart_and_sleeps_only_whats_left() {
    let harness = Harness::new(&plain_context("Say it"));
    let down = || Turn::Fails("Internal Server Error".to_owned());
    harness.script(vec![down(), down(), down(), down()]);
    *harness.models.after.lock().unwrap() = Some(Turn::Hangs);
    let first = tokio::spawn(run_space_task_agent(harness.deps(), harness.stored()));
    let stored = loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if let Some(stored) = saved(&harness).filter(|stored| stored.state.as_ref().is_some_and(|state| matches!(state.stage, Stage::Outage { .. }))) {
            break stored;
        }
    };
    first.abort();
    let _ = first.await;
    let Some(Stage::Outage { outage, wait_started_ms, wake_at_ms, .. }) = stored.state.as_ref().map(|state| state.stage.clone()) else {
        panic!("the file says it's waiting");
    };
    assert_eq!(outage, 0);
    assert_eq!(wake_at_ms - wait_started_ms, 30_000);
    // Misty was closed for ten of the thirty seconds.
    harness.clock.fetch_add(10_000, Ordering::SeqCst);
    harness.script(vec![answer("Said.")]);
    *harness.models.after.lock().unwrap() = None;
    let waking = tokio::time::Instant::now();
    let ended = run_space_task_agent(harness.deps(), stored).await.unwrap();
    assert!(!ended.incomplete);
    let slept = waking.elapsed();
    assert!(slept >= Duration::from_secs(20) && slept < Duration::from_secs(21), "{slept:?}");
}

#[tokio::test(start_paused = true)]
async fn a_takeover_survives_a_restart_at_its_next_poll() {
    let harness = Harness::new(&plain_context("Compare the plans"));
    let paused = json(r#"{"messages":[{"sequence":1,"text":"Use the yearly price"}],"paused":true,"closed":false}"#);
    let polls = AtomicUsize::new(0);
    *harness.control.intercept.lock().unwrap() = Some(Box::new(move |action, body| {
        if action != "steering" {
            return None;
        }
        let boundary = field(body, "boundary");
        if boundary == "0:before" {
            return Some(Ok(paused.clone()));
        }
        if boundary.contains(":paused:") {
            // The person is still there for the first poll, and hands back on the second.
            let seen = polls.fetch_add(1, Ordering::SeqCst);
            return Some(Ok(json(if seen == 0 { r#"{"messages":[],"paused":true}"# } else { r#"{"messages":[{"sequence":2,"text":"And the monthly"}],"paused":false}"# })));
        }
        None
    }));
    harness.script(vec![finished()]);
    let first = tokio::spawn(run_space_task_agent(harness.deps(), harness.stored()));
    let stored = loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let found = saved(&harness).filter(|stored| stored.state.as_ref().is_some_and(|state| matches!(&state.stage, Stage::Takeover { next_poll: 2, .. })));
        if let Some(stored) = found {
            break stored;
        }
    };
    first.abort();
    let _ = first.await;
    run_space_task_agent(harness.deps(), stored).await.unwrap();
    let boundaries: Vec<String> = harness.control.calls.lock().unwrap().iter().filter(|(action, ..)| action == "steering").map(|(_, body, _)| field(body, "boundary")).collect();
    assert_eq!(boundaries, ["0:before", "0:paused:1", "0:paused:2", "0:finish"]);
    let prompt = harness.prompt_json(0);
    let (first_said, second_said, note) = (prompt.find("Use the yearly price").unwrap(), prompt.find("And the monthly").unwrap(), prompt.find(RESUME_NOTE).unwrap());
    assert!(first_said < second_said && second_said < note);
}

#[tokio::test]
async fn steering_taken_before_a_restart_is_not_lost() {
    let harness = Harness::new(&plain_context("Do it"));
    *harness.control.intercept.lock().unwrap() = Some(Box::new(|action, body| {
        (action == "steering" && field(body, "boundary") == "0:before").then(|| Ok(json(r#"{"messages":[{"sequence":1,"text":"Be quick"}],"closed":false}"#)))
    }));
    harness.script(vec![Turn::Hangs]);
    let first = tokio::spawn(run_space_task_agent(harness.deps(), harness.stored()));
    while harness.models.calls.lock().unwrap().is_empty() {
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    first.abort();
    let _ = first.await;
    let stored = saved(&harness).unwrap();
    assert!(matches!(stored.state.as_ref().unwrap().stage, Stage::SteeringTaken));
    // The server hands steering over once: the second process doesn't ask for this boundary again.
    *harness.control.intercept.lock().unwrap() = None;
    let asked = |harness: &Harness| harness.control.calls.lock().unwrap().iter().filter(|(action, body, _)| action == "steering" && field(body, "boundary") == "0:before").count();
    assert_eq!(asked(&harness), 1);
    harness.script(vec![answer("Done.")]);
    run_space_task_agent(harness.deps(), stored).await.unwrap();
    assert_eq!(asked(&harness), 1);
    let count = harness.models.calls.lock().unwrap().len();
    assert!(harness.prompt_json(count - 1).contains("Be quick"));
}

// teach-turn.test.ts covers the streaming and budget by themselves (`teach_turn.rs`); this is the turn.

#[tokio::test]
async fn a_lesson_step_goes_out_a_sentence_at_a_time_with_no_agent_tools() {
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "Teach.", "prompt": "Show me", "allowed_tools": [], "teach": true, "teach_tool_budget": 0 }).to_string());
    let mut parts = text("a", "Make an empty dict. Then loop");
    parts.push(finish("stop", 1, 1));
    harness.script(vec![Turn::Parts(parts)]);
    let ended = run_space_task_agent(harness.deps(), harness.stored()).await.unwrap();
    assert_eq!(ended.text, "Make an empty dict. Then loop");
    assert!(harness.models.calls.lock().unwrap()[0].tools.is_empty());
    let calls = harness.control.calls.lock().unwrap();
    let deltas: Vec<(String, String)> = calls
        .iter()
        .filter(|(action, body, _)| action == "events" && field(body, "node_id").starts_with("teach:"))
        .map(|(_, body, _)| (field(body, "node_id"), field(body.get("output").unwrap(), "text_delta")))
        .collect();
    assert_eq!(deltas, [("teach:1".to_owned(), "Make an empty dict. ".to_owned()), ("teach:2".to_owned(), "Then loop".to_owned())]);
    drop(calls);
    assert_eq!(field(&harness.control.completions()[0], "status"), "success");
}
