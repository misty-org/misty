use super::*;
use crate::browser::agent_pages::action_confirm as confirm;
use crate::browser::pages::native_page;
use misty_page_runtime::{Approval, PageHost};

pub(crate) const CURSOR_GLIDE_MS: u64 = 320;

pub(super) struct TabHost<'a> {
    pub app: &'a AppHandle,
    pub state: &'a BrowserSessionState,
    pub view: &'a Webview,
    pub request: &'a BrowserAgentExecuteRequest,
}

fn cursor_script(prepared: &Value) -> Option<String> {
    let (x, y) = (
        prepared["point"]["x"].as_f64()?,
        prepared["point"]["y"].as_f64()?,
    );
    Some(format!(
        "{}\nwindow[Symbol.for('misty.browser.agent.cursor')]?.move({:.4}*innerWidth,{:.4}*innerHeight,{{hold:true}});",
        include_str!("../../kiri_link/scripts/agent_cursor.js"),
        x,
        y
    ))
}

impl PageHost for TabHost<'_> {
    async fn call(
        &self,
        frame: Option<u64>,
        operation: &str,
        args: Value,
        semantic: bool,
    ) -> Result<Value, String> {
        let mut held = native_page::held_events().subscribe();
        if native_page::HOLDS_DIALOGS && self.held_dialog().await.is_some() {
            return Err(misty_page_runtime::DIALOG_HELD.to_owned());
        }
        let call = call_at(self.view, frame, operation, args, semantic);
        tokio::pin!(call);
        loop {
            tokio::select! {
                done = &mut call => return done,
                event = held.recv() => {
                    if matches!(event, Err(tokio::sync::broadcast::error::RecvError::Closed)) {
                        return call.await;
                    }
                    if self.held_dialog().await.is_some() {
                        return Err(misty_page_runtime::DIALOG_HELD.to_owned());
                    }
                }
            }
        }
    }

    fn holds_dialogs(&self) -> bool {
        native_page::HOLDS_DIALOGS
    }

    async fn hold_dialogs(&self, on: bool) {
        native_page::hold_dialogs(self.view, on).await;
    }

    async fn held_dialog(&self) -> Option<Value> {
        native_page::held_dialog(self.view).await
    }

    async fn answer_dialog(&self, accept: bool, text: Option<String>) -> Option<Value> {
        native_page::answer_dialog(self.view, accept, text).await
    }

    async fn native(&self, input: Value, prepared: &Value) -> Result<Option<Value>, String> {
        if !cfg!(any(target_os = "macos", windows, target_os = "linux")) {
            return Ok(None);
        }
        let (id, _) = resolve_agent_webview(self.app, self.state, self.request)?;
        let generation = self
            .state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?
            .get(&id)
            .map(|session| session.snapshot_generation)
            .ok_or("Browser tab is not running.")?;
        let origin = crate::browser::browser_page_origin(
            &self.view.url().map_err(|error| error.to_string())?,
        );
        let observed = json!({"viewport": prepared["viewport"], "editable": prepared["editable"]});
        match native_input::dispatch(
            self.app,
            self.view.clone(),
            self.request,
            &input,
            &origin,
            &observed,
            generation,
        )
        .await
        {
            Ok(result) => Ok(Some(result)),
            Err(error) if error.contains("must be visible") => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn approve(&self, kind: &str, control: &str, reason: &str) -> Approval {
        let origin = confirm::page_origin(self.view);
        if !confirm::asks(self.request, kind) || confirm::covered(self.request, &origin, kind) {
            return Approval::Unasked;
        }
        match confirm::ask(self.app, self.view, self.request, kind, control, reason).await {
            confirm::Answer::Allowed => Approval::Allowed,
            confirm::Answer::Refused => Approval::Refused,
            confirm::Answer::Unanswered => Approval::Unanswered,
        }
    }

    fn authorize(&self) -> Result<(), String> {
        crate::agents::task_scopes::authorize_scope(
            self.app,
            &self.request.scope_id,
            &self.request.agent_id,
            self.request.input["__mistyTaskId"].as_str().unwrap_or(""),
        )?;
        resolve_agent_webview(self.app, self.state, self.request)?;
        Ok(())
    }

    async fn sleep(&self, ms: u64) {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    fn fresh_id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }

    async fn capture(
        &self,
        region: [f64; 4],
        image_width: f64,
        lossless: bool,
    ) -> Result<Value, String> {
        native_page::capture(self.view, region, image_width, lossless).await
    }

    async fn cookies(&self, request: Value) -> Result<Value, String> {
        native_page::cookies(self.view, request).await
    }

    async fn emulate(&self, request: Value) -> Result<Value, String> {
        native_page::emulate(self.view, request).await
    }

    async fn resize(&self, size: Option<(f64, f64)>) -> Result<(), String> {
        crate::browser::pages::emulated_size::set(self.app, self.view, size)
    }

    async fn pdf(&self) -> Result<Vec<u8>, String> {
        native_page::pdf(self.view).await
    }

    fn downloads(&self) -> Vec<Value> {
        let task = self.request.input["__mistyTaskId"]
            .as_str()
            .filter(|task| !task.is_empty());
        let Ok((id, _)) = resolve_agent_webview(self.app, self.state, self.request) else {
            return Vec::new();
        };
        let Ok(sessions) = self.state.sessions.lock() else {
            return Vec::new();
        };
        sessions
            .get(&id)
            .map(|session| {
                session
                    .downloads
                    .iter()
                    .filter(|item| task.is_none_or(|task| item.task_id.as_deref() == Some(task)))
                    .filter_map(|item| serde_json::to_value(item).ok())
                    .map(|mut item| {
                        item["sourceScopeId"] = json!(self.request.scope_id);
                        item
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn url(&self) -> Option<String> {
        self.view.url().ok().map(|url| url.to_string())
    }

    fn go(&self, to: misty_page_runtime::Go<'_>) -> Result<(), String> {
        match to {
            misty_page_runtime::Go::Address(address) => {
                let target = url::Url::parse(address).map_err(|error| error.to_string())?;
                self.view
                    .navigate(target)
                    .map_err(|error| error.to_string())
            }
            misty_page_runtime::Go::Back => self
                .view
                .eval("history.back()")
                .map_err(|error| error.to_string()),
            misty_page_runtime::Go::Forward => self
                .view
                .eval("history.forward()")
                .map_err(|error| error.to_string()),
            misty_page_runtime::Go::Reload => self
                .view
                .eval("location.reload()")
                .map_err(|error| error.to_string()),
        }
    }

    async fn before_read(&self) -> Option<String> {
        decline_consent(self.view).await
    }

    fn frame_of(&self, reference: Option<&str>) -> Option<(u64, String)> {
        frame_of(self.view, reference)
    }

    async fn point(&self, prepared: &Value) {
        if let Some(cursor) = cursor_script(prepared) {
            if self.view.eval(cursor).is_ok() {
                tokio::time::sleep(Duration::from_millis(CURSOR_GLIDE_MS)).await;
            }
        }
    }

    fn open_address(&self, href: &str) -> bool {
        let script = format!(
            "location.assign({})",
            serde_json::to_string(href).unwrap_or_default()
        );
        self.view.eval(script).is_ok()
    }

    async fn frames_show(&self, condition: &Value) -> bool {
        #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
        {
            frames::shows(self.view, condition).await
        }
        #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
        {
            let _ = condition;
            false
        }
    }

    async fn with_frame_trees(&self, snapshot: &mut Value) {
        with_frame_trees(self.view, snapshot).await;
    }
}
