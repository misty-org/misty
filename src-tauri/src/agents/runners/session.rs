//! Runs one turn of a coding tool: starts it in the project, feeds it the task,
//! reads what it prints, answers its permission questions through the bridge
//! (asking the person through the server when the bridge says so), mirrors its
//! events and stops it when the run is canceled or its budget runs out.
use std::{future::Future, pin::Pin, process::Stdio};

use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::oneshot,
};

use super::{
    bridge::{self, BridgeContext, Decision},
    events::{PermissionRequest, RunnerEvent},
    lease::LeaseMeter,
    Launch, Runner, RunnerError,
};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Where a session reports to: the server, through the device's signed client.
pub trait SessionHost: Send + Sync {
    /// Forwards events to the run's stream on the server.
    fn emit<'a>(&'a self, events: Vec<RunnerEvent>) -> BoxFuture<'a, ()>;
    /// Asks the person through the server's approval card and waits for the
    /// answer. A timeout or any failure is a no.
    fn ask<'a>(
        &'a self,
        request: &'a PermissionRequest,
        action: &'static str,
    ) -> BoxFuture<'a, bool>;
    /// Unix seconds now, so tests can drive lease expiry.
    fn now(&self) -> i64;
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Finished,
    Canceled,
    /// Stopped at a turn boundary: the lease is spent or expired.
    BudgetExhausted,
    Failed(String),
}

/// Answers one permission question and returns the line to send back.
pub async fn answer_permission(
    host: &dyn SessionHost,
    context: &BridgeContext,
    request: &PermissionRequest,
) -> (bool, String) {
    match bridge::decide(request, context) {
        Decision::Allow => (true, String::new()),
        Decision::Deny { reason } => (false, reason),
        Decision::AskPerson { action } => {
            if host.ask(request, action).await {
                (true, String::new())
            } else {
                (
                    false,
                    "The person said no, or didn't answer. Don't try another way; report it."
                        .to_owned(),
                )
            }
        }
    }
}

/// What a turn has seen so far, shared by every transport's driver.
#[derive(Default)]
pub struct TurnTracker {
    pub finished: bool,
    pub exhausted: bool,
    pub failure: Option<String>,
}

impl TurnTracker {
    /// Answers the permission questions among a step's events, records usage
    /// against the lease and the turn's end, then mirrors the events. Returns
    /// each question with the answer to send back in the tool's protocol.
    pub async fn absorb(
        &mut self,
        events: Vec<RunnerEvent>,
        context: &mut BridgeContext,
        meter: &mut LeaseMeter,
        host: &dyn SessionHost,
    ) -> Vec<(PermissionRequest, bool, String)> {
        let mut answers = Vec::new();
        for event in &events {
            match event {
                RunnerEvent::PermissionRequest(request) => {
                    context.lease_valid = meter.valid(host.now());
                    let (allow, reason) = answer_permission(host, context, request).await;
                    answers.push((request.clone(), allow, reason));
                }
                RunnerEvent::Usage(usage) => {
                    if !meter.record(usage, host.now()) {
                        self.exhausted = true;
                    }
                }
                RunnerEvent::Done { .. } => self.finished = true,
                RunnerEvent::Error { message } => self.failure = Some(message.clone()),
                _ => {}
            }
        }
        if !events.is_empty() {
            host.emit(events).await;
        }
        answers
    }

    pub fn outcome(self, canceled: bool) -> Outcome {
        if canceled {
            Outcome::Canceled
        } else if let Some(message) = self.failure {
            Outcome::Failed(message)
        } else if self.exhausted {
            Outcome::BudgetExhausted
        } else if self.finished {
            Outcome::Finished
        } else {
            Outcome::Failed("The coding tool stopped without finishing.".into())
        }
    }
}

pub async fn run_turn(
    runner: &dyn Runner,
    launch: &Launch,
    mut context: BridgeContext,
    meter: &mut LeaseMeter,
    host: &dyn SessionHost,
    mut stop: oneshot::Receiver<()>,
) -> Result<Outcome, RunnerError> {
    if !meter.valid(host.now()) {
        return Ok(Outcome::BudgetExhausted);
    }
    context.lease_valid = true;
    let spec = runner.build_command(launch)?;
    let mut protocol = runner.protocol(launch);
    let mut child = Command::new(&spec.program)
        .args(&spec.args)
        .envs(spec.env.iter().cloned())
        .current_dir(&spec.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| RunnerError::Invalid("the coding tool could not start"))?;
    let mut stdin = child.stdin.take().ok_or(RunnerError::Invalid("no stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or(RunnerError::Invalid("no stdout"))?;
    let mut lines = BufReader::new(stdout).lines();
    for line in protocol.initial_input() {
        let _ = stdin.write_all(format!("{line}\n").as_bytes()).await;
    }
    let mut canceled = false;
    let mut tracker = TurnTracker::default();
    loop {
        let line = tokio::select! {
            _ = &mut stop => { canceled = true; break; }
            line = lines.next_line() => line,
        };
        let Ok(Some(line)) = line else { break };
        let step = protocol.on_line(&line);
        for write in step.writes {
            let _ = stdin.write_all(format!("{write}\n").as_bytes()).await;
        }
        let answers = tracker.absorb(step.events, &mut context, meter, host).await;
        for (request, allow, reason) in answers {
            if let Some(reply) = protocol.answer(&request, allow, &reason) {
                let _ = stdin.write_all(format!("{reply}\n").as_bytes()).await;
            }
        }
        if tracker.finished {
            break;
        }
    }
    drop(stdin);
    let _ = child.start_kill();
    let _ = child.wait().await;
    Ok(tracker.outcome(canceled))
}
