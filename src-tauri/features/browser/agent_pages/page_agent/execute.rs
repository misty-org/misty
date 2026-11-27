use super::*;

pub(in crate::browser) async fn execute(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let view = webview(app, id)?;
    let host = TabHost {
        app,
        state,
        view: &view,
        request,
    };
    if matches!(
        request.operation.as_str(),
        "browser.storage" | "browser.emulate"
    ) && !crate::browser::is_agent_page(id)
    {
        return Ok(rejected(
            "browser_own_tab_only",
            "Storage and the view are changed only in your own tabs, never in the person's.",
        ));
    }
    if request.operation != "browser.steps" {
        if let Some(refused) = misty_page_runtime::modal_refusal(&host).await {
            return Ok(refused);
        }
    }
    match request.operation.as_str() {
        "browser.storage" => return misty_page_runtime::storage(&host, &request.input).await,
        "browser.emulate" => return misty_page_runtime::emulate(&host, &request.input).await,
        "browser.pdf" => return save_pdf(&host, request).await,
        "browser.page_tools" => return misty_page_runtime::page_tools(&host, &request.input).await,
        _ => {}
    }
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
        "browser.console" => {
            let level = input["level"].as_str().unwrap_or("info");
            let result = call(
                &view,
                "console",
                json!({"since": 0, "level": level, "limit": 200}),
                false,
            )
            .await?;
            if input["clear"] == true {
                call(&view, "consoleClear", json!({}), false).await?;
            }
            json!({"messages": result["messages"], "omitted": result["omitted"], "watched": result["watched"]})
        }
        "browser.network" if input["request"].is_number() => {
            let result = call(&view, "networkRequest", json!({"id": input["request"]}), false).await?;
            if result["ok"] != true {
                return Ok(rejected(
                    result["errorCode"].as_str().unwrap_or("browser_network_missing"),
                    result["error"].as_str().unwrap_or("That request isn't in the page's log."),
                ));
            }
            json!({"request": result["request"], "note": result["note"]})
        }
        "browser.network" => {
            let mut args =
                json!({"since": 0, "limit": 200, "includeStatic": input["includeStatic"] == true});
            if let Some(filter) = input["filter"].as_str().filter(|filter| !filter.is_empty()) {
                args["filter"] = json!(filter);
            }
            let result = call(&view, "network", args, false).await?;
            if input["clear"] == true {
                call(&view, "networkClear", json!({}), false).await?;
            }
            json!({"requests": result["requests"], "omitted": result["omitted"], "watched": result["watched"]})
        }
        "browser.verify" => {
            let args = json!({"documentId": input["documentId"], "checks": input["checks"]});
            let result = call(&view, "verify", args, true).await?;
            if result["ok"] != true {
                return Err(page_error(&result, "The page could not be checked."));
            }
            json!({"passed": result["passed"], "checks": result["checks"]})
        }
        "browser.highlight" => {
            let mut args = json!({"documentId": input["documentId"]});
            for field in ["ref", "refs", "label"] {
                if !input[field].is_null() {
                    args[field] = input[field].clone();
                }
            }
            let operation = if input["clear"] == true {
                "highlightClear"
            } else {
                "highlight"
            };
            let result = call(&view, operation, args, true).await?;
            if result["ok"] != true {
                return Ok(rejected(
                    result["errorCode"]
                        .as_str()
                        .unwrap_or("browser_highlight_invalid"),
                    result["error"]
                        .as_str()
                        .unwrap_or("That can't be highlighted."),
                ));
            }
            json!({"highlighted": result["highlighted"]})
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
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            {
                let reads = frames::markdown(&view).await;
                if let (false, Some(markdown)) = (reads.is_empty(), result["markdown"].as_str()) {
                    result["markdown"] = json!(frames::append_markdown(markdown, &reads));
                }
            }
            result
        }
        "browser.wait_for" => match wait_for(&host, input).await {
            Err(error) if error.starts_with("Wait for") => {
                return Ok(rejected("browser_step_invalid", error))
            }
            result => result?,
        },
        "browser.skill" => misty_page_runtime::run_skill(&host, input).await?,
        "browser.steps" | "browser.fill_form" => {
            let parsed = if request.operation == "browser.steps" {
                misty_page_runtime::parse_steps(input)
            } else {
                misty_page_runtime::form_steps(input)
            };
            match parsed {
                Ok(steps) => {
                    let done = misty_page_runtime::run_steps(&host, input, &steps).await?;
                    if done["heldDialog"].is_object() {
                        dismiss_later(view.clone());
                        return Ok(done);
                    }
                    done
                }
                Err(error) => return Ok(rejected("browser_step_invalid", error)),
            }
        }
        _ => return Err("Unsupported browser agent operation.".into()),
    };
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

async fn wait_for(host: &TabHost<'_>, input: &Value) -> Result<Value, String> {
    let condition = json!({
        "text": input["text"].as_str(), "textGone": input["textGone"].as_str(), "urlIncludes": input["urlIncludes"].as_str(),
    });
    if condition["text"].is_null()
        && condition["textGone"].is_null()
        && condition["urlIncludes"].is_null()
    {
        let Some(seconds) = input["seconds"].as_f64().filter(|seconds| *seconds > 0.0) else {
            return Err("Wait for text, textGone, urlIncludes or a number of seconds.".into());
        };
        let waited = (seconds.min(30.0) * 1000.0) as u64;
        tokio::time::sleep(Duration::from_millis(waited)).await;
        let page = call(host.view, "observe", json!({}), false).await?;
        return Ok(json!({"met": true, "waitedMs": waited, "page": page}));
    }
    let timeout = input["timeoutMs"]
        .as_u64()
        .unwrap_or(8_000)
        .clamp(100, misty_page_runtime::MAX_WAIT_MS);
    misty_page_runtime::poll(host, &condition, timeout).await
}

async fn save_pdf(
    host: &TabHost<'_>,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let Some(run_id) = request
        .policy
        .call
        .as_ref()
        .map(|call| call.facts.run_id.clone())
        .filter(|run| !run.is_empty())
    else {
        return Ok(rejected(
            "browser_pdf_unavailable",
            "A PDF is saved into your working folder, and this run has none.",
        ));
    };
    let asked = request.input["path"]
        .as_str()
        .filter(|path| !path.trim().is_empty())
        .unwrap_or("page.pdf");
    let asked = if asked.to_ascii_lowercase().ends_with(".pdf") {
        asked.to_owned()
    } else {
        format!("{asked}.pdf")
    };
    let bytes = match misty_page_runtime::PageHost::pdf(host).await {
        Ok(bytes) => bytes,
        Err(error) => return Ok(rejected("browser_pdf_failed", error)),
    };
    let size = bytes.len();
    let saved = tauri::async_runtime::spawn_blocking(move || {
        crate::apps::agent_files::save(&run_id, &asked, &bytes)
    })
    .await
    .map_err(|error| error.to_string())?;
    match saved {
        Ok(path) => Ok(json!({"saved": path, "bytes": size})),
        Err(error) => Ok(rejected("browser_pdf_failed", error)),
    }
}

fn dismiss_later(view: tauri::Webview) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(180)).await;
        if crate::browser::pages::native_page::answer_dialog(&view, false, None)
            .await
            .is_some()
        {
            let _ = call(&view, "acting", json!({"on": false}), false).await;
        }
    });
}
