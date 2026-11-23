use super::*;

pub(super) struct OutOfTurn {
    spawned: SpawnedAcp,
    pub(super) agent: Value,
    folder: PathBuf,
    killed: AtomicBool,
    cleanup: Vec<PathBuf>,
}

impl OutOfTurn {
    pub(super) async fn open(context: &Context, folder: &Path) -> Result<Self, String> {
        let BuiltCommand {
            mut command,
            cleanup_files,
            ..
        } = launch(context, folder)?;
        let mut spawned = match spawn_piped_acp(&mut command, &context.engine, folder) {
            Ok(spawned) => spawned,
            Err(error) => {
                crate::engines::cleanup_staged_files(&cleanup_files);
                return Err(error);
            }
        };
        spawned.acp.reports_as = Some(context.engine.clone());
        let mut live = Self {
            spawned,
            agent: Value::Null,
            folder: folder.to_path_buf(),
            killed: AtomicBool::new(false),
            cleanup: cleanup_files,
        };
        match live
            .call("initialize", initialize_params(), RPC_HANDSHAKE_TIMEOUT)
            .await
        {
            Ok(agent) => {
                live.agent = agent;
                Ok(live)
            }
            Err(error) => {
                live.close().await;
                Err(error)
            }
        }
    }

    pub(super) fn cwd(&self) -> String {
        self.folder.to_string_lossy().into_owned()
    }

    pub(super) fn can(&self, call: &str) -> bool {
        has_session_call(&self.agent, call)
    }

    pub(super) async fn attach(&mut self, session: &str) -> Result<(), String> {
        let method = if self.can("resume") {
            "session/resume"
        } else {
            "session/load"
        };
        let params = json!({ "sessionId": session, "cwd": self.cwd(), "mcpServers": [] });
        self.call(method, params, SESSION_RESUME_TIMEOUT)
            .await
            .map(|_| ())
    }

    pub(super) async fn call(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let folder = self.folder.clone();
        let mut router = move |line: &AcpLine| answer(&folder, line);
        let result = self
            .spawned
            .acp
            .routed(method, params, timeout, &self.killed, None, &mut router)
            .await;
        result.map_err(|error| self.message(error))
    }

    pub(super) async fn prompt(
        &mut self,
        session: &str,
        text: &str,
        limit: Duration,
    ) -> Result<String, String> {
        let folder = self.folder.clone();
        let mut reply = String::new();
        let mut router = |line: &AcpLine| {
            if let AcpLine::Notification { method, params } = line {
                if method == "session/update" && params["sessionId"].as_str() == Some(session) {
                    let update = &params["update"];
                    match update["sessionUpdate"].as_str() {
                        Some("agent_message_chunk") => {
                            if let Some(chunk) = update["content"]["text"].as_str() {
                                reply.push_str(chunk);
                            }
                        }
                        Some("tool_call") => reply.clear(),
                        _ => {}
                    }
                }
                return None;
            }
            answer(&folder, line)
        };
        let params = json!({ "sessionId": session, "prompt": [{ "type": "text", "text": text }] });
        let result = self
            .spawned
            .acp
            .routed(
                "session/prompt",
                params,
                limit,
                &self.killed,
                Some(session),
                &mut router,
            )
            .await;
        let result = result.map_err(|error| self.message(error))?;
        match result["stopReason"].as_str() {
            Some("cancelled") => Err("The side question was cancelled.".into()),
            Some("refusal") => Err("The engine refused to answer.".into()),
            _ => Ok(reply.trim().to_string()),
        }
    }

    fn message(&self, raw: String) -> String {
        if let Some(message) = raw
            .strip_prefix("rpc:")
            .and_then(|rest| rest.splitn(3, ':').nth(2))
            .map(str::trim)
            .filter(|message| !message.is_empty())
        {
            return message.to_string();
        }
        let stderr = self
            .spawned
            .stderr_buf
            .lock()
            .map(|tail| tail.trim().to_string())
            .unwrap_or_default();
        if stderr.is_empty() {
            raw
        } else {
            stderr
        }
    }

    pub(super) async fn close(mut self) {
        teardown(&mut self.spawned.child).await;
        crate::engines::cleanup_staged_files(&self.cleanup);
    }
}

pub(super) fn has_session_call(agent: &Value, call: &str) -> bool {
    agent
        .pointer(&format!("/agentCapabilities/sessionCapabilities/{call}"))
        .is_some_and(|capability| !capability.is_null())
}

fn answer(folder: &Path, line: &AcpLine) -> Option<Value> {
    let AcpLine::AgentRequest { id, method, params } = line else {
        return None;
    };
    Some(match method.as_str() {
        "session/request_permission" => {
            jsonrpc_result_response(id, json!({ "outcome": { "outcome": "cancelled" } }))
        }
        "elicitation/create" => jsonrpc_result_response(id, json!({ "action": "decline" })),
        "fs/read_text_file" => answer_agent_request(folder, id, method, params),
        _ => jsonrpc_error_response(
            id,
            JSONRPC_METHOD_NOT_FOUND,
            "Misty answers no requests out of turn",
        ),
    })
}

fn launch(context: &Context, folder: &Path) -> Result<BuiltCommand, String> {
    let engine_id = context.engine.as_str();
    let engine = crate::engines::engine_by_id(engine_id).ok_or("That engine has no adapter.")?;
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, engine_id);
    let provider = crate::engines::support::config::resolve_provider(engine_id, None)?;
    let request = SendRequest {
        session_id: context.session.clone(),
        workspace: folder.to_path_buf(),
        prompt: String::new(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: settings
            .default_models
            .get(engine_id)
            .filter(|model| !model.trim().is_empty())
            .cloned(),
        effort: None,
        service_tier: None,
        permission: None,
        additional_dirs: Vec::new(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    };
    let mut env = crate::engine_config::engine_env::env_for(engine_id)?;
    if let Some(provider) = provider.as_ref() {
        env.extend(crate::engines::support::provider_files::channel_env(
            engine_id, provider,
        )?);
    }
    env.extend(crate::engines::channels::env_for(engine_id));
    let mut built = engine.host_command(&request, &bin)?;
    for (key, value) in &env {
        built.command.env(key, value);
    }
    let configured = match (engine_id, provider.as_ref()) {
        ("kimi", Some(_)) => {
            crate::engines::kimi::apply_channel(&mut built.command, &env, &request)
        }
        ("grok", Some(provider)) => {
            crate::engines::grok::isolate_channel(&mut built, provider, &request)
        }
        _ => Ok(()),
    };
    if let Err(error) = configured {
        crate::engines::cleanup_staged_files(&built.cleanup_files);
        return Err(error);
    }
    Ok(built)
}
