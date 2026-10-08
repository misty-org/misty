//! The connection to the account's clipboard room: sessions, tickets and the
//! WebSocket that delivers clips from other devices.

use super::*;

pub(super) struct Session {
    pub(super) generation: u64,
    pub(super) api_base: String,
    pub(super) account_id: String,
    pub(super) local_device_id: String,
    pub(super) server_device_id: String,
    pub(super) device_name: String,
    pub(super) key: Arc<ClipboardKey>,
    pub(super) client: reqwest::Client,
    pub(super) ticket: tokio::sync::Mutex<Option<Ticket>>,
}

pub(super) async fn run(inner: Arc<Inner>, generation: u64, start: CloudStart) {
    let mut backoff = Duration::from_secs(2);
    while inner.current(generation) {
        let session = match open_session(&inner, generation, &start).await {
            Ok(Some(session)) => session,
            Ok(None) => {
                tokio::time::sleep(Duration::from_secs(15)).await;
                continue;
            }
            Err(status) => {
                inner.set_status(status);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(60));
                continue;
            }
        };
        if let Ok(mut slot) = inner.session.write() {
            *slot = Some(session.clone());
        }
        inner.set_status(CloudStatus::Connecting);
        match listen(&inner, &session).await {
            Ok(()) => backoff = Duration::from_secs(2),
            Err(_) => {
                inner.set_status(CloudStatus::Unavailable);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(60));
            }
        }
    }
}

/// A session needs the clipboard on in this device's own policy, the device
/// added to the account, and the vault open here for the key.
pub(super) async fn open_session(
    inner: &Arc<Inner>,
    generation: u64,
    start: &CloudStart,
) -> Result<Option<Arc<Session>>, CloudStatus> {
    if !device_trust::effective_policy().clipboard || !device_trust::self_admitted() {
        if let Ok(mut slot) = inner.session.write() {
            *slot = None;
        }
        inner.set_status(CloudStatus::Off);
        return Ok(None);
    }
    let Some((root, scope, _)) =
        crate::infra::browser_sync::device_admission_authority(&start.account_id).await
    else {
        inner.set_status(CloudStatus::Locked);
        return Ok(None);
    };
    let key = root
        .clipboard_key(&scope)
        .map_err(|_| CloudStatus::Locked)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| CloudStatus::Unavailable)?;
    Ok(Some(Arc::new(Session {
        generation,
        api_base: start.api_base.clone(),
        account_id: start.account_id.clone(),
        local_device_id: start.local_device_id.clone(),
        server_device_id: start.server_device_id.clone(),
        device_name: start.device_name.clone(),
        key: Arc::new(key),
        client,
        ticket: tokio::sync::Mutex::new(None),
    })))
}

impl Session {
    /// A ticket signed by the Misty API for this device; reused for four minutes.
    pub(super) async fn ticket(&self) -> Result<Ticket, CloudStatus> {
        let mut slot = self.ticket.lock().await;
        if let Some(ticket) = slot
            .as_ref()
            .filter(|ticket| ticket.fetched.elapsed() < Duration::from_secs(240))
        {
            return Ok(ticket.clone());
        }
        let http = DeviceHttp::new(&self.api_base, &self.account_id)
            .map_err(|_| CloudStatus::Unavailable)?;
        let identity = DeviceIdentity::load(&self.account_id, &self.local_device_id)
            .map_err(|_| CloudStatus::Unavailable)?;
        let mut ticket: Ticket = http
            .signed(
                &identity,
                reqwest::Method::POST,
                &format!("devices/{}/clipboard-ticket", self.server_device_id),
                None::<&()>,
            )
            .await
            .map_err(|error| match error {
                crate::infra::device_http::DeviceHttpError::Status(403, _) => CloudStatus::Off,
                _ => CloudStatus::Unavailable,
            })?;
        if !ticket.url.starts_with("https://") || ticket.room.len() != 64 {
            return Err(CloudStatus::Unavailable);
        }
        ticket.fetched = Instant::now();
        *slot = Some(ticket.clone());
        Ok(ticket)
    }

    pub(super) fn room_url(ticket: &Ticket, path: &str) -> String {
        format!(
            "{}/v1/rooms/{}/{}",
            ticket.url.trim_end_matches('/'),
            ticket.room,
            path
        )
    }
}

pub(super) async fn listen(inner: &Arc<Inner>, session: &Arc<Session>) -> Result<(), CloudStatus> {
    let ticket = session.ticket().await?;
    let mut url = url::Url::parse(&Session::room_url(&ticket, "socket"))
        .map_err(|_| CloudStatus::Unavailable)?;
    url.set_scheme("wss")
        .map_err(|_| CloudStatus::Unavailable)?;
    url.query_pairs_mut().append_pair("ticket", &ticket.ticket);
    let socket = open_device_socket(&url, MAX_SOCKET_FRAME)
        .await
        .map_err(|_| CloudStatus::Unavailable)?;
    let (mut sink, mut stream) = socket.split();
    inner.set_status(CloudStatus::Ready);
    let mut keepalive = tokio::time::interval(KEEPALIVE);
    keepalive.tick().await;
    loop {
        if !inner.current(session.generation) || !device_trust::effective_policy().clipboard {
            let _ = sink.close().await;
            return Ok(());
        }
        tokio::select! {
            message = stream.next() => {
                let Some(Ok(message)) = message else { return Err(CloudStatus::Unavailable) };
                let SocketMessage::Text(text) = message else { continue };
                if text.as_str() == "pong" { continue; }
                if let Ok(event) = serde_json::from_str::<RoomEvent>(text.as_str()) {
                    receive(inner, session, event).await;
                }
            }
            _ = keepalive.tick() => {
                if sink.send(SocketMessage::Text("ping".into())).await.is_err() {
                    return Err(CloudStatus::Unavailable);
                }
            }
        }
    }
}

pub(super) async fn receive(inner: &Arc<Inner>, session: &Arc<Session>, event: RoomEvent) {
    match event {
        RoomEvent::Clips { clips } => {
            for clip in clips {
                let opened = open_manifest(session, &clip);
                if let (Some(summary), Some(manifest)) = (opened.summary, opened.manifest) {
                    inner.remember(summary, manifest);
                }
            }
        }
        RoomEvent::Clip { clip } => {
            let opened = open_manifest(session, &clip);
            let (Some(summary), Some(manifest)) = (opened.summary, opened.manifest) else {
                return;
            };
            inner.remember(summary.clone(), manifest.clone());
            if summary.from_this_device {
                return;
            }
            let Ok(payload) = hydrate(inner, session, &summary, &manifest).await else {
                return;
            };
            let handler = inner
                .handler
                .read()
                .ok()
                .and_then(|handler| handler.clone());
            if let Some(handler) = handler {
                handler(payload);
            }
        }
    }
}
