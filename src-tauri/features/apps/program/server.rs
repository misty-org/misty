use super::*;

pub(super) struct Server {
    pub(super) _child: Child,
    pub(super) stdin: ChildStdin,
    pub(super) stdout: BufReader<ChildStdout>,
    next_id: u64,
    pub(super) last_used: Instant,
}

pub(super) enum Trouble {
    Refused(String),
    Lost(String),
}

impl Server {
    pub(super) async fn start(
        program: &Path,
        spec: &McpProgram,
        work: &Path,
    ) -> Result<Self, String> {
        let (mut command, keep) = confined(program, work)?;
        let real_work = fs::canonicalize(work)
            .map_err(|error| format!("Couldn't open the chat's folder: {error}"))?;
        command
            .args(&spec.args)
            .arg(&spec.read_root_flag)
            .arg(&real_work)
            .arg(&spec.write_root_flag)
            .arg(&real_work)
            .current_dir(&real_work)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HOME", &real_work)
            .env("TMPDIR", &real_work)
            .env("LANG", "C.UTF-8")
            .envs(&spec.env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Couldn't start the app's tools: {error}"))?;
        #[cfg_attr(not(target_os = "linux"), allow(dropping_copy_types))]
        drop(keep);
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Couldn't talk to the app's tools.".to_owned())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Couldn't talk to the app's tools.".to_owned())?;
        let mut server = Self {
            _child: child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
            last_used: Instant::now(),
        };
        let hello = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "misty", "version": env!("CARGO_PKG_VERSION") },
        });
        match tokio::time::timeout(START_LIMIT, server.request("initialize", hello)).await {
            Ok(Ok(_)) => {}
            Ok(Err(Trouble::Refused(message) | Trouble::Lost(message))) => {
                return Err(format!("The app's tools didn't start: {message}"))
            }
            Err(_) => return Err("The app's tools took too long to start.".into()),
        }
        server
            .send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await
            .map_err(|_| "The app's tools stopped as they started.".to_owned())?;
        Ok(server)
    }

    pub(super) async fn send(&mut self, message: &Value) -> std::io::Result<()> {
        let mut line = message.to_string().into_bytes();
        line.push(b'\n');
        self.stdin.write_all(&line).await?;
        self.stdin.flush().await
    }

    pub(super) async fn request(&mut self, method: &str, params: Value) -> Result<Value, Trouble> {
        let id = self.next_id;
        self.next_id += 1;
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        self.send(&message)
            .await
            .map_err(|_| Trouble::Refused("The app's tools have stopped.".into()))?;
        loop {
            let mut line = Vec::new();
            let read = (&mut self.stdout)
                .take(MAX_LINE_BYTES)
                .read_until(b'\n', &mut line)
                .await
                .map_err(|_| Trouble::Lost("The app's tools stopped while working.".into()))?;
            if read == 0 {
                return Err(Trouble::Lost(
                    "The app's tools stopped while working.".into(),
                ));
            }
            if line.last() != Some(&b'\n') && read as u64 >= MAX_LINE_BYTES {
                return Err(Trouble::Lost(
                    "The app's tools answered with more than Misty reads.".into(),
                ));
            }
            let Ok(answer) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            if answer.get("method").is_some() {
                if let Some(asked) = answer.get("id").filter(|asked| !asked.is_null()) {
                    let reply = match answer["method"].as_str() {
                        Some("ping") => json!({ "jsonrpc": "2.0", "id": asked, "result": {} }),
                        Some("roots/list") => {
                            json!({ "jsonrpc": "2.0", "id": asked, "result": { "roots": [] } })
                        }
                        _ => json!({
                            "jsonrpc": "2.0", "id": asked,
                            "error": { "code": -32601, "message": "Misty doesn't offer that." },
                        }),
                    };
                    self.send(&reply).await.map_err(|_| {
                        Trouble::Lost("The app's tools stopped while working.".into())
                    })?;
                }
                continue;
            }
            if answer["id"].as_u64() != Some(id) {
                continue;
            }
            if let Some(error) = answer.get("error") {
                let text = error["message"]
                    .as_str()
                    .unwrap_or("The app's tools refused the call.");
                return Err(Trouble::Refused(text.chars().take(2_000).collect()));
            }
            return Ok(answer.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    pub(super) async fn list_tools(&mut self) -> Result<Vec<Value>, String> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let params = match &cursor {
                Some(cursor) => json!({ "cursor": cursor }),
                None => json!({}),
            };
            let page = match tokio::time::timeout(START_LIMIT, self.request("tools/list", params))
                .await
            {
                Ok(Ok(page)) => page,
                Ok(Err(Trouble::Refused(message) | Trouble::Lost(message))) => return Err(message),
                Err(_) => return Err("The app's tools took too long to list themselves.".into()),
            };
            tools.extend(page["tools"].as_array().cloned().unwrap_or_default());
            cursor = page["nextCursor"]
                .as_str()
                .filter(|next| !next.is_empty())
                .map(str::to_owned);
            if cursor.is_none() {
                return Ok(tools);
            }
        }
        Ok(tools)
    }
}
