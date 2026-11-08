//! The socket to Soniox: `RealtimeSttSession` from `@soniox/node`, with what the relay uses of it.
use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::{future::BoxFuture, SinkExt, StreamExt};
use tokio::{
    net::TcpStream,
    sync::{mpsc, oneshot},
};
use tokio_tungstenite::{
    client_async_tls,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
    MaybeTlsStream, WebSocketStream,
};

use super::super::network::{ipv4_first, HostLookup, SystemLookup};
use super::session::{SttError, SttEvent, SttEvents, SttFactory, SttStream};
use super::soniox::{parse_message, SonioxConfig};

const SONIOX_URL: &str = "wss://stt-rt.soniox.com/transcribe-websocket";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Opens streams on the device's Soniox key. It deliberately has no `Debug`, which could print it.
pub struct SonioxFactory {
    url: String,
    api_key: String,
}

impl SonioxFactory {
    pub fn new(api_key: String) -> Self {
        Self { url: SONIOX_URL.to_owned(), api_key }
    }

    /// Reaches a local mock in tests. The app always goes to the real address.
    #[doc(hidden)]
    pub fn at(url: &str, api_key: &str) -> Self {
        Self { url: url.to_owned(), api_key: api_key.to_owned() }
    }
}

impl SttFactory for SonioxFactory {
    fn open(&self, config: &SonioxConfig, events: SttEvents) -> Arc<dyn SttStream> {
        Arc::new(SonioxStream {
            url: self.url.clone(),
            api_key: self.api_key.clone(),
            config: serde_json::to_string(config).unwrap_or_default(),
            link: Arc::new(Link { state: Mutex::new(Phase::Idle), finish: Mutex::new(None), out: Mutex::new(None), events }),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Phase {
    Idle,
    Connecting,
    Connected,
    Finishing,
    Ended,
}

/// What the stream and the task running its socket share.
struct Link {
    state: Mutex<Phase>,
    finish: Mutex<Option<oneshot::Sender<Result<(), SttError>>>>,
    out: Mutex<Option<mpsc::UnboundedSender<Message>>>,
    events: SttEvents,
}

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Link {
    fn phase(&self) -> Phase {
        *locked(&self.state)
    }

    fn set_phase(&self, phase: Phase) {
        *locked(&self.state) = phase;
    }

    fn settle_finish(&self, result: Result<(), SttError>) {
        if let Some(waiting) = locked(&self.finish).take() {
            let _ = waiting.send(result);
        }
    }

    /// Ends the stream: nothing more is reported, and the socket closes.
    fn end(&self) {
        self.set_phase(Phase::Ended);
        if let Some(out) = locked(&self.out).take() {
            let _ = out.send(Message::Close(None));
        }
    }

    /// Something went wrong with the connection.
    fn failed(&self) {
        if self.phase() == Phase::Ended {
            return;
        }
        (self.events)(SttEvent::Error);
        self.settle_finish(Err(SttError));
        self.end();
    }

    /// `handleMessage`. Control tokens don't reach the result, and become events.
    fn message(&self, text: &str) {
        if self.phase() == Phase::Ended {
            return;
        }
        let Some(mut parsed) = parse_message(text) else {
            self.failed();
            return;
        };
        parsed.result.tokens.retain(|token| token.text != "<end>" && token.text != "<fin>");
        (self.events)(SttEvent::Result(parsed.result));
        // The result may have failed the session, which closes this stream.
        if parsed.has_endpoint && self.phase() != Phase::Ended {
            (self.events)(SttEvent::Endpoint);
        }
        if parsed.finished {
            self.settle_finish(Ok(()));
            self.end();
        }
    }

    fn send(&self, message: Message) -> Result<(), SttError> {
        let sent = locked(&self.out).as_ref().is_some_and(|out| out.send(message).is_ok());
        if sent {
            Ok(())
        } else {
            self.failed();
            Err(SttError)
        }
    }
}

struct SonioxStream {
    url: String,
    api_key: String,
    config: String,
    link: Arc<Link>,
}

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Connects with the key in the `Authorization` header, which is what `@soniox/node` picks for Node
/// because proxies and logs redact it. The TypeScript went through the session class directly, which
/// defaults to the subprotocol list; tungstenite fails a handshake when the server doesn't echo one.
/// IPv4 goes first, as `src/network.ts` set for the whole process.
async fn open_socket(url: &str, api_key: &str) -> Option<Socket> {
    let mut request = url.into_client_request().ok()?;
    let mut bearer = HeaderValue::from_str(&format!("Bearer {api_key}")).ok()?;
    bearer.set_sensitive(true);
    request.headers_mut().insert("authorization", bearer);
    let host = request.uri().host()?.trim_matches(['[', ']']).to_owned();
    let tls = request.uri().scheme_str() == Some("wss");
    let port = request.uri().port_u16().unwrap_or(if tls { 443 } else { 80 });
    let found = SystemLookup.lookup(&host).await.ok()?;
    let addresses: Vec<SocketAddr> = ipv4_first(found).into_iter().map(|ip| SocketAddr::new(ip, port)).collect();
    let stream = TcpStream::connect(addresses.as_slice()).await.ok()?;
    let (socket, _) = client_async_tls(request, stream).await.ok()?;
    Some(socket)
}

/// Runs the socket until the stream ends: what the stream sends goes out in order, and what arrives
/// is reported.
async fn run_socket(link: Arc<Link>, socket: Socket, mut outgoing: mpsc::UnboundedReceiver<Message>) {
    let (mut write, mut read) = socket.split();
    loop {
        tokio::select! {
            message = outgoing.recv() => match message {
                Some(Message::Close(_)) | None => {
                    let _ = write.send(Message::Close(None)).await;
                    return;
                }
                Some(message) => {
                    if write.send(message).await.is_err() {
                        link.failed();
                        return;
                    }
                }
            },
            incoming = read.next() => match incoming {
                Some(Ok(Message::Text(text))) => link.message(text.as_str()),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                    link.failed();
                    return;
                }
                Some(Ok(_)) => {}
            },
        }
    }
}

impl SttStream for SonioxStream {
    fn connect(&self) -> BoxFuture<'_, Result<(), SttError>> {
        Box::pin(async move {
            {
                let mut state = locked(&self.link.state);
                if *state != Phase::Idle {
                    return Err(SttError);
                }
                *state = Phase::Connecting;
            }
            let opened = tokio::time::timeout(CONNECT_TIMEOUT, async {
                let mut socket = open_socket(&self.url, &self.api_key).await?;
                socket.send(Message::text(self.config.clone())).await.ok()?;
                Some(socket)
            });
            let Ok(Some(socket)) = opened.await else {
                self.link.set_phase(Phase::Ended);
                return Err(SttError);
            };
            // `close` may have come while this waited.
            let mut state = locked(&self.link.state);
            if *state != Phase::Connecting {
                return Err(SttError);
            }
            *state = Phase::Connected;
            drop(state);
            let (sender, receiver) = mpsc::unbounded_channel();
            *locked(&self.link.out) = Some(sender);
            tokio::spawn(run_socket(self.link.clone(), socket, receiver));
            Ok(())
        })
    }

    fn send_audio(&self, data: &[u8]) -> Result<(), SttError> {
        if self.link.phase() != Phase::Connected {
            return Err(SttError);
        }
        self.link.send(Message::binary(data.to_vec()))
    }

    fn finish(&self) -> BoxFuture<'_, Result<(), SttError>> {
        Box::pin(async move {
            let (sender, receiver) = oneshot::channel();
            {
                let mut state = locked(&self.link.state);
                if *state != Phase::Connected {
                    return Err(SttError);
                }
                *state = Phase::Finishing;
            }
            *locked(&self.link.finish) = Some(sender);
            // An empty text frame is Soniox's end of audio.
            self.link.send(Message::text(""))?;
            receiver.await.unwrap_or(Err(SttError))
        })
    }

    fn close(&self) {
        if self.link.phase() == Phase::Ended {
            return;
        }
        self.link.settle_finish(Err(SttError));
        self.link.end();
    }
}

impl Drop for SonioxStream {
    fn drop(&mut self) {
        self.close();
    }
}
