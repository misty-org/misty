use super::{
    call, page_error, resolve_agent_webview, webview, BrowserAgentExecuteRequest,
    BrowserSessionState,
};
use serde_json::{json, Value};
use tauri::AppHandle;

pub(in crate::browser) async fn upload(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
    input: &Value,
) -> Result<Value, String> {
    let view = webview(app, id)?;
    crate::agents::task_scopes::authorize_scope(
        app,
        &request.scope_id,
        &request.agent_id,
        input["__mistyTaskId"].as_str().unwrap_or(""),
    )?;
    resolve_agent_webview(app, state, request)?;
    let document = input["documentId"]
        .as_str()
        .ok_or("browser_snapshot_stale: take a snapshot first")?;
    if input["drop"] == true {
        let args = json!({"documentId": document, "ref": input["ref"], "files": [input["file"]]});
        let result = call(&view, "dropFiles", args, false).await?;
        if result["ok"] != true {
            return Err(page_error(&result, "The file wasn't dropped."));
        }
        return Ok(
            json!({"dropped": result["dropped"], "accepted": result["accepted"], "websiteUploadVerified": false}),
        );
    }
    let args = json!({"documentId": document, "step": {"action": "upload", "ref": input["ref"]}, "file": input["file"]});
    let result = call(&view, "perform", args, false).await?;
    if result["ok"] != true {
        return Err(page_error(&result, "File upload failed."));
    }
    Ok(
        json!({"inputSelected": result["inputSelected"], "name": result["name"], "byteSize": result["byteSize"], "websiteUploadVerified": false}),
    )
}
