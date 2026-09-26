//! Starts a hosted tool's server for one turn and stops it afterwards. The
//! server listens on a free loopback port in its own process group, so
//! stopping it also stops whatever it started.
use std::{
    net::TcpListener,
    process::Stdio,
    time::{Duration, Instant},
};

use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    process::{Child, Command},
    sync::mpsc,
};

use super::{super::CommandSpec, HostAuth};

const START_WAIT: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(250);

pub struct HostedServer {
    pub origin: String,
    /// The session cookie a token-authenticated server issued.
    pub cookie: Option<String>,
    child: Child,
}

/// A port nothing listens on right now.
pub fn free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()?
        .local_addr()
        .ok()
        .map(|address| address.port())
}

/// The one-time token in a line like `dsh web: http://127.0.0.1:3080/?token=…`.
pub fn token_in(line: &str) -> Option<String> {
    let start = line.find("?token=").or_else(|| line.find("&token="))? + "?token=".len();
    let token: String = line[start..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    (!token.is_empty()).then_some(token)
}

fn forward_lines(
    reader: impl AsyncRead + Unpin + Send + 'static,
    lines: mpsc::UnboundedSender<String>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = lines.send(line);
        }
    });
}

impl HostedServer {
    pub async fn start(
        spec: &CommandSpec,
        port: u16,
        auth: HostAuth,
        client: &reqwest::Client,
    ) -> Result<Self, String> {
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .envs(spec.env.iter().cloned())
            .current_dir(&spec.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .spawn()
            .map_err(|_| "The coding tool could not start.".to_owned())?;
        let (sender, mut lines) = mpsc::unbounded_channel();
        if let Some(stdout) = child.stdout.take() {
            forward_lines(stdout, sender.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            forward_lines(stderr, sender);
        }
        let mut server = Self {
            origin: format!("http://127.0.0.1:{port}"),
            cookie: None,
            child,
        };
        let deadline = Instant::now() + START_WAIT;
        let mut token = None;
        while Instant::now() < deadline {
            if matches!(server.child.try_wait(), Ok(Some(_))) {
                return Err("The coding tool's server stopped while starting.".into());
            }
            while let Ok(line) = lines.try_recv() {
                token = token.or_else(|| token_in(&line));
            }
            let ready = match auth {
                HostAuth::None { health } => client
                    .get(format!("{}{health}", server.origin))
                    .send()
                    .await
                    .is_ok_and(|response| response.status().is_success()),
                HostAuth::TokenCookie => match &token {
                    Some(token) => {
                        server.cookie = exchange(client, &server.origin, token).await;
                        server.cookie.is_some()
                    }
                    None => false,
                },
            };
            if ready {
                // Keep draining the output so the server never blocks on a full pipe.
                tokio::spawn(async move { while lines.recv().await.is_some() {} });
                return Ok(server);
            }
            tokio::time::sleep(POLL).await;
        }
        server.stop().await;
        Err("The coding tool's server didn't start in time.".into())
    }

    /// Stops the server and everything it started.
    pub async fn stop(mut self) {
        #[cfg(unix)]
        if let Some(pid) = self.child.id() {
            // SAFETY: signals the process group this server leads.
            unsafe {
                libc::killpg(pid as libc::pid_t, libc::SIGTERM);
            }
        }
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}

/// Trades the one-time token for the session cookie: `GET /?token=…`
/// answers with a redirect that sets it.
async fn exchange(client: &reqwest::Client, origin: &str, token: &str) -> Option<String> {
    let response = client
        .get(format!("{origin}/?token={token}"))
        .send()
        .await
        .ok()?;
    if !response.status().is_redirection() && !response.status().is_success() {
        return None;
    }
    response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .map(str::trim)
        .find(|pair| pair.contains('='))
        .map(str::to_owned)
}
