//! Running one page-layer operation for an agent, and waiting on the page.
use super::*;

pub(in crate::infra::browser) async fn execute(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let view = webview(app, id)?;
    let observed_url = view.url().map_err(|error| error.to_string())?;
    let target = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        let session = sessions.get(id).ok_or("Browser tab is not running.")?;
        browser_target_observation(session, &observed_url)
    };
    if target["authentication"] == "required" {
        if acts(&request.operation) {
            return Ok(rejected("browser_authentication_required", "This page needs the person to sign in. Call browser_request_user_action, then take a new snapshot."));
        }
        let mut safe_url = observed_url.clone();
        safe_url.set_query(None);
        safe_url.set_fragment(None);
        return Ok(json!({
            "documentId": uuid::Uuid::new_v4().to_string(), "url": safe_url.to_string(), "title": "Sign-in required",
            "tree": "- text: Complete sign-in in the original browser. Call browser_request_user_action before continuing.",
            "truncated": true, "contentTrust": "untrusted-web-page", "target": target,
        }));
    }
    let input = &request.input;
    let result = match request.operation.as_str() {
        "browser.snapshot" => {
            let max = input["maxChars"]
                .as_u64()
                .unwrap_or(SNAPSHOT_CHARS)
                .clamp(2_000, 60_000);
            let mut args = json!({"candidateId": uuid::Uuid::new_v4().to_string(), "maxChars": max, "maxRefs": 800});
            if let Some(scope) = input["scopeRef"].as_str() {
                args["scopeRef"] = json!(scope);
            }
            let scoped = !input["scopeRef"].is_null();
            let declined = if scoped {
                None
            } else {
                decline_consent(&view).await
            };
            let mut result = call(&view, "snapshot", args, true).await?;
            if let Some(label) = declined {
                result["consentDeclined"] = json!(label);
            }
            if result["ok"] != true {
                return Err(page_error(&result, "The page could not be read."));
            }
            if !scoped {
                with_frame_trees(&view, &mut result).await;
            }
            result
        }
        "browser.find" => {
            let Some(query) = input["query"]
                .as_str()
                .filter(|query| !query.trim().is_empty() && query.len() <= 500)
            else {
                return Ok(rejected(
                    "browser_step_invalid",
                    "Describe the element to find in up to 500 characters.",
                ));
            };
            let limit = input["limit"].as_u64().unwrap_or(8).clamp(1, 20);
            let args = json!({"candidateId": uuid::Uuid::new_v4().to_string(), "query": query, "limit": limit});
            let result = call(&view, "find", args, true).await?;
            if result["ok"] != true {
                return Err(page_error(&result, "The page could not be searched."));
            }
            result
        }
        "browser.extract" => {
            let mut result = call(&view, "markdown", json!({"maxChars": 120_000}), false).await?;
            if result["ok"] != true {
                return Err(page_error(&result, "The page could not be read."));
            }
            #[cfg(any(target_os = "macos", windows))]
            {
                let reads = frames::markdown(&view).await;
                if let (false, Some(markdown)) = (reads.is_empty(), result["markdown"].as_str()) {
                    result["markdown"] = json!(frames::append_markdown(markdown, &reads));
                }
            }
            result
        }
        "browser.wait_for" => match wait_for(&view, input).await {
            Err(error) if error.starts_with("Wait for") => {
                return Ok(rejected("browser_step_invalid", error))
            }
            result => result?,
        },
        "browser.skill" => run_skill(app, state, &view, request).await?,
        "browser.steps" | "browser.fill_form" => {
            let parsed = if request.operation == "browser.steps" {
                steps::parse_steps(input)
            } else {
                steps::form_steps(input)
            };
            match parsed {
                Ok(steps) => run_steps(app, state, &view, request, &steps).await?,
                Err(error) => return Ok(rejected("browser_step_invalid", error)),
            }
        }
        _ => return Err("Unsupported browser agent operation.".into()),
    };
    // A navigation while reading means the result describes a page that is gone.
    if !acts(&request.operation) && view.url().map_err(|error| error.to_string())? != observed_url {
        return Err(
            "browser_document_changed: the page navigated while it was read; read it again".into(),
        );
    }
    let mut result = result;
    result["contentTrust"] = json!("untrusted-web-page");
    result["target"] = target;
    if let Some(object) = result.as_object_mut() {
        object.remove("ok");
    }
    Ok(result)
}

async fn wait_for(view: &Webview, input: &Value) -> Result<Value, String> {
    let condition = json!({
        "text": input["text"].as_str(), "textGone": input["textGone"].as_str(), "urlIncludes": input["urlIncludes"].as_str(),
    });
    if condition["text"].is_null()
        && condition["textGone"].is_null()
        && condition["urlIncludes"].is_null()
    {
        return Err("Wait for text, textGone or urlIncludes.".into());
    }
    let timeout = input["timeoutMs"]
        .as_u64()
        .unwrap_or(8_000)
        .clamp(100, steps::MAX_WAIT_MS);
    poll(view, &condition, timeout).await
}

pub(super) async fn poll(view: &Webview, condition: &Value, timeout_ms: u64) -> Result<Value, String> {
    let started = Instant::now();
    loop {
        let check = call(view, "waitCheck", condition.clone(), false).await?;
        // Text can appear inside an embedded widget's frame rather than the page itself.
        #[cfg(any(target_os = "macos", windows))]
        let met = check["met"] == true
            || (condition["text"].is_string() && frames::shows(view, condition).await);
        #[cfg(not(any(target_os = "macos", windows)))]
        let met = check["met"] == true;
        let waited = started.elapsed().as_millis() as u64;
        if met || waited >= timeout_ms {
            let page = call(view, "observe", json!({}), false).await?;
            return Ok(json!({"met": met, "waitedMs": waited, "page": page}));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}
