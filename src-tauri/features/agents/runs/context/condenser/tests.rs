use std::sync::Mutex;

use super::*;
use crate::transcript::fixtures::{call_message, json, result_message, text_output};
use crate::transcript::user_message;
use crate::model_calls::ToolOutput;

const IDLE: Measured = Measured { input_tokens: 0.0, sent_bytes: 0, window: 1000.0 };

struct Step<'a> {
    name: &'a str,
    keep: usize,
    seen: &'a Mutex<Vec<String>>,
}

impl Condenser for Step<'_> {
    fn name(&self) -> &str {
        self.name
    }

    fn condense<'a>(&'a self, messages: &'a [Message], pressure: ContextPressure) -> BoxFuture<'a, Option<Condensed>> {
        self.seen.lock().unwrap().push(format!("{}:{}", self.name, messages.len()));
        let kept = messages[messages.len() - self.keep..].to_vec();
        ready(Some(Condensed { messages: kept, estimate: pressure.estimate / 2.0 })).boxed()
    }
}

struct Untouched;

impl Condenser for Untouched {
    fn name(&self) -> &str {
        "noop"
    }

    fn condense<'a>(&'a self, _: &'a [Message], _: ContextPressure) -> BoxFuture<'a, Option<Condensed>> {
        ready(None).boxed()
    }
}

#[tokio::test]
async fn runs_condensers_in_order_each_on_the_previous_ones_result() {
    let seen = Mutex::new(Vec::new());
    let first = Step { name: "first", keep: 3, seen: &seen };
    let second = Step { name: "second", keep: 1, seen: &seen };
    let messages = [user_message("a"), user_message("b"), user_message("c"), user_message("d")];
    let result = condense(&messages, IDLE, &[&first, &second]).await;
    assert_eq!(*seen.lock().unwrap(), ["first:4", "second:3"]);
    assert_eq!(json(&result), json(&[user_message("d")]));
}

#[tokio::test]
async fn leaves_the_transcript_alone_when_a_step_has_nothing_to_do() {
    let messages = [user_message("a")];
    assert!(matches!(condense(&messages, IDLE, &[&Untouched]).await, Cow::Borrowed(_)));
}

#[tokio::test]
async fn keeps_the_transcript_when_a_summary_fails() {
    let failing = SummarizedSteps { summarize: Box::new(|_| ready(Err("model unavailable".to_owned())).boxed()) };
    let messages: Vec<Message> = (0..30).map(|index| user_message(format!("message {index} {}", "x".repeat(4000)))).collect();
    assert!(matches!(condense(&messages, IDLE, &[&failing]).await, Cow::Borrowed(_)));
}

#[tokio::test]
async fn a_periodic_summary_runs_when_due_and_says_so() {
    let done = Mutex::new(0);
    let step = PeriodicSummary {
        summarize: Box::new(|_| ready(Ok("Notes.".to_owned())).boxed()),
        due: Box::new(|| true),
        done: Box::new(|| *done.lock().unwrap() += 1),
    };
    let messages: Vec<Message> = (0..14)
        .flat_map(|index| {
            let id = format!("c{index}");
            vec![call_message(&id, "x", "{}"), result_message(&id, "x", text_output("y".repeat(8_000)))]
        })
        .collect();
    let mut with_task = vec![user_message("Go")];
    with_task.extend(messages);
    let out = condense(&with_task, IDLE, &[&step]).await;
    assert!(json(&out).contains("Notes."));
    drop(step);
    assert_eq!(done.into_inner().unwrap(), 1);
}

fn cut_notes(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| match message {
            Message::Tool { content, .. } => matches!(&content[0].output, ToolOutput::Text { value } if value.starts_with("[Older result cut")),
            _ => false,
        })
        .count()
}

fn pages(count: usize, size: usize) -> Vec<Message> {
    let page = format!(r#"{{"tree":"{}"}}"#, "x".repeat(size));
    (0..count)
        .flat_map(|index| {
            let id = format!("c{index}");
            vec![call_message(&id, "browser_snapshot", "{}"), result_message(&id, "browser_snapshot", text_output(page.clone()))]
        })
        .collect()
}

#[tokio::test]
async fn trims_by_the_transcripts_size_even_when_the_last_call_reported_a_small_uncached_input() {
    let messages = pages(12, 20_000);
    let measured = Measured { input_tokens: 3_000.0, sent_bytes: 1_000, window: 200_000.0 };
    let out = condense(&messages, measured, &[&WorkingSet]).await;
    assert_eq!(cut_notes(&out), 10);
}

#[tokio::test]
async fn holds_a_small_cut_back_so_the_cached_prefix_survives() {
    let messages = pages(6, 9_000);
    let measured = Measured { input_tokens: 30_000.0, sent_bytes: 60_000, window: 200_000.0 };
    assert!(matches!(condense(&messages, measured, &[&WorkingSet]).await, Cow::Borrowed(_)));
}
