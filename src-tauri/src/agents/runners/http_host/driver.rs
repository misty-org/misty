//! Drives one turn of a hosted tool: starts its server, runs the adapter's
//! requests, feeds it the event stream, answers permission questions through
//! the bridge and stops everything when the turn ends or is canceled.
use std::collections::VecDeque;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

use super::{
    super::{
        bridge::BridgeContext,
        lease::LeaseMeter,
        session::{Outcome, SessionHost, TurnTracker},
        Launch, RunnerError,
    },
    server::{free_port, HostedServer},
    sse::SseDecoder,
    HostCall, HostStep, HostedProtocol, HostedRunner, StreamKind,
};

/// A live connection to a hosted tool's server.
pub struct Connection {
    pub client: reqwest::Client,
    pub origin: String,
    /// Where the WebSocket lives, normally the origin with a ws scheme.
    pub ws_origin: String,
    pub cookie: Option<String>,
    pub kind: StreamKind,
    messages: Option<mpsc::UnboundedReceiver<Value>>,
}

impl Connection {
    pub fn new(
        client: reqwest::Client,
        origin: &str,
        cookie: Option<String>,
        kind: StreamKind,
    ) -> Self {
        Self {
            client,
            origin: origin.to_owned(),
            ws_origin: origin.replacen("http", "ws", 1),
            cookie,
            kind,
            messages: None,
        }
    }

    async fn post(&self, path: &str, body: &Value) -> (u16, Value) {
        let mut request = self
            .client
            .post(format!("{}{path}", self.origin))
            .json(body);
        if let Some(cookie) = &self.cookie {
            request = request.header(reqwest::header::COOKIE, cookie);
        }
        match request.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                (status, response.json().await.unwrap_or(Value::Null))
            }
            Err(_) => (0, Value::Null),
        }
    }

    async fn open(&mut self, path: &str, frames: Vec<Value>) -> Result<(), ()> {
        let (sender, receiver) = mpsc::unbounded_channel();
        match self.kind {
            StreamKind::Sse => {
                let response = self
                    .client
                    .get(format!("{}{path}", self.origin))
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .send()
                    .await
                    .map_err(|_| ())?;
                if !response.status().is_success() {
                    return Err(());
                }
                let mut bytes = response.bytes_stream();
                tokio::spawn(async move {
                    let mut decoder = SseDecoder::default();
                    while let Some(Ok(chunk)) = bytes.next().await {
                        for value in decoder.push(&chunk) {
                            if sender.send(value).is_err() {
                                return;
                            }
                        }
                    }
                });
            }
            StreamKind::WebSocket => {
                let mut request = format!("{}{path}", self.ws_origin)
                    .into_client_request()
                    .map_err(|_| ())?;
                if let Some(cookie) = self
                    .cookie
                    .as_deref()
                    .and_then(|cookie| cookie.parse().ok())
                {
                    request.headers_mut().insert("Cookie", cookie);
                }
                let (socket, _) = tokio_tungstenite::connect_async(request)
                    .await
                    .map_err(|_| ())?;
                let (mut write, mut read) = socket.split();
                for frame in frames {
                    write
                        .send(Message::text(frame.to_string()))
                        .await
                        .map_err(|_| ())?;
                }
                tokio::spawn(async move {
                    let _write = write;
                    while let Some(Ok(message)) = read.next().await {
                        let Message::Text(text) = message else {
                            continue;
                        };
                        if let Ok(value) = serde_json::from_str(text.as_str()) {
                            if sender.send(value).is_err() {
                                return;
                            }
                        }
                    }
                });
            }
        }
        self.messages = Some(receiver);
        Ok(())
    }

    async fn execute(&mut self, call: HostCall, protocol: &mut dyn HostedProtocol) -> HostStep {
        match call {
            HostCall::Post { tag, path, body } => {
                let (status, body) = self.post(&path, &body).await;
                protocol.on_response(tag, status, body)
            }
            HostCall::OpenStream { path, frames } => match self.open(&path, frames).await {
                Ok(()) => HostStep::default(),
                Err(()) => HostStep::error("Couldn't follow the coding tool's progress."),
            },
        }
    }

    async fn next(&mut self) -> Option<Value> {
        match &mut self.messages {
            Some(messages) => messages.recv().await,
            None => None,
        }
    }
}

pub async fn run_hosted_turn(
    runner: &dyn HostedRunner,
    launch: &Launch,
    context: BridgeContext,
    meter: &mut LeaseMeter,
    host: &dyn SessionHost,
    stop: oneshot::Receiver<()>,
) -> Result<Outcome, RunnerError> {
    if !meter.valid(host.now()) {
        return Ok(Outcome::LeaseExpired);
    }
    let port = free_port().ok_or(RunnerError::Invalid("no free port for the coding tool"))?;
    let spec = runner.server(launch, port)?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| RunnerError::Invalid("couldn't prepare the connection"))?;
    let server = match HostedServer::start(&spec, port, runner.auth(), &client).await {
        Ok(server) => server,
        Err(message) => return Ok(Outcome::Failed(message)),
    };
    let connection = Connection::new(
        client,
        &server.origin,
        server.cookie.clone(),
        runner.stream(),
    );
    let outcome = drive(
        connection,
        runner.protocol(launch),
        context,
        meter,
        host,
        stop,
    )
    .await;
    server.stop().await;
    Ok(outcome)
}

/// Runs the turn over a connected server until it ends.
pub async fn drive(
    mut connection: Connection,
    mut protocol: Box<dyn HostedProtocol>,
    mut context: BridgeContext,
    meter: &mut LeaseMeter,
    host: &dyn SessionHost,
    mut stop: oneshot::Receiver<()>,
) -> Outcome {
    context.lease_valid = true;
    let mut tracker = TurnTracker::default();
    let mut queue: VecDeque<HostCall> = protocol.start().into();
    let mut canceled = false;
    'turn: loop {
        while let Some(call) = queue.pop_front() {
            let step = connection.execute(call, protocol.as_mut()).await;
            absorb(
                step,
                protocol.as_mut(),
                &mut tracker,
                &mut context,
                meter,
                host,
                &mut queue,
            )
            .await;
            if tracker.finished || tracker.failure.is_some() {
                break 'turn;
            }
        }
        let message = tokio::select! {
            _ = &mut stop => { canceled = true; break; }
            message = connection.next() => message,
        };
        let Some(message) = message else { break };
        let step = protocol.on_message(message);
        absorb(
            step,
            protocol.as_mut(),
            &mut tracker,
            &mut context,
            meter,
            host,
            &mut queue,
        )
        .await;
        if tracker.finished || tracker.failure.is_some() {
            break;
        }
    }
    if canceled || !tracker.finished {
        for call in protocol.cancel() {
            let _ = connection.execute(call, protocol.as_mut()).await;
        }
    }
    tracker.outcome(canceled)
}

async fn absorb(
    step: HostStep,
    protocol: &mut dyn HostedProtocol,
    tracker: &mut TurnTracker,
    context: &mut BridgeContext,
    meter: &mut LeaseMeter,
    host: &dyn SessionHost,
    queue: &mut VecDeque<HostCall>,
) {
    queue.extend(step.calls);
    for (request, allow, reason) in tracker.absorb(step.events, context, meter, host).await {
        queue.extend(protocol.answer(&request, allow, &reason));
    }
}
