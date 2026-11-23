use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use space_drive::{Drive, Link, SpaceId};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const FIRST_WAIT: Duration = Duration::from_secs(1);
const LONGEST_WAIT: Duration = Duration::from_secs(60);

#[derive(Default)]
pub(crate) struct NativeLink {
    send: Mutex<Option<mpsc::UnboundedSender<String>>>,
}

impl NativeLink {
    fn set(&self, send: Option<mpsc::UnboundedSender<String>>) {
        *self
            .send
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = send;
    }

    pub(crate) fn up(&self) -> bool {
        self.send
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some()
    }
}

impl Link for NativeLink {
    fn send(&self, message: Value) -> bool {
        self.send
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(|send| send.send(message.to_string()).is_ok())
    }
}

fn socket_url(base: &url::Url, ticket: &str) -> Option<url::Url> {
    let mut url = base.clone();
    let scheme = match base.scheme() {
        "https" => "wss",
        "http" => "ws",
        _ => return None,
    };
    url.set_scheme(scheme).ok()?;
    url.set_path(&format!("{}/realtime", base.path().trim_end_matches('/')));
    url.query_pairs_mut()
        .clear()
        .append_pair("ticket", ticket)
        .append_pair("live", "1")
        .append_pair("only", "drive.");
    Some(url)
}

fn age_of(created_at: Option<&str>) -> Option<Duration> {
    let at = chrono::DateTime::parse_from_rfc3339(created_at?).ok()?;
    let elapsed = chrono::Utc::now().signed_duration_since(at.with_timezone(&chrono::Utc));
    Some(Duration::from_millis(
        elapsed.num_milliseconds().max(0) as u64
    ))
}

async fn pass_event(drive: &Drive, event: &Value) {
    let (Some(space), Some(kind)) = (
        event.get("space_id").and_then(Value::as_str),
        event.get("type").and_then(Value::as_str),
    ) else {
        return;
    };
    if !kind.starts_with("drive.") {
        return;
    }
    let payload = event.get("payload").cloned().unwrap_or(Value::Null);
    let age = age_of(event.get("created_at").and_then(Value::as_str));
    drive
        .realtime(&SpaceId(space.to_owned()), kind, &payload, age)
        .await;
}

async fn heard(drive: &Drive, text: &str) {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return;
    };
    match message.get("type").and_then(Value::as_str) {
        Some("event") => {
            if let Some(event) = message.get("event") {
                pass_event(drive, event).await;
            }
        }
        Some("replay") => {
            for event in message
                .get("events")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                pass_event(drive, event).await;
            }
            if message
                .get("resync_required")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                for mount in drive.mounted() {
                    drive.kick(&mount.space);
                }
            }
        }
        _ => {}
    }
}

async fn connect_once(drive: &Drive, link: &Arc<NativeLink>, base: &url::Url) -> bool {
    let Ok(ticket) = drive.realtime_ticket().await else {
        return false;
    };
    let Some(url) = socket_url(base, &ticket) else {
        return false;
    };
    let Ok((socket, _)) = tokio_tungstenite::connect_async(url.as_str()).await else {
        return false;
    };
    let (mut write, mut read) = socket.split();
    let (send, mut outgoing) = mpsc::unbounded_channel::<String>();
    link.set(Some(send));
    drive.link_up().await;
    loop {
        tokio::select! {
            incoming = read.next() => match incoming {
                Some(Ok(Message::Text(text))) => heard(drive, text.as_str()).await,
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            out = outgoing.recv() => match out {
                Some(text) => {
                    if write.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
        }
    }
    link.set(None);
    true
}

pub(crate) fn start(
    drive: Drive,
    base: url::Url,
) -> (Arc<NativeLink>, tokio::task::JoinHandle<()>) {
    let link = Arc::new(NativeLink::default());
    drive.set_link(Some(link.clone() as Arc<dyn Link>));
    let task_link = link.clone();
    let task = drive.runtime().clone().spawn(async move {
        let mut wait = FIRST_WAIT;
        loop {
            if connect_once(&drive, &task_link, &base).await {
                wait = FIRST_WAIT;
            }
            tokio::time::sleep(wait).await;
            wait = (wait * 2).min(LONGEST_WAIT);
        }
    });
    (link, task)
}
