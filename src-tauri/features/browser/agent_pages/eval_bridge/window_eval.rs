//! Running JavaScript in a person's own app window (debug builds only), for the acceptance specs.
//! It reaches the app's real modules the way the interface does, so sign-in, keys and messages
//! take their real paths. Website tabs are refused.
use super::*;

const MAX_WAIT: Duration = Duration::from_secs(600);
const DEFAULT_WAIT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(50);
/// How long one look at the window may take. A window that is reloading never answers.
const LOOK: Duration = Duration::from_secs(5);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowEval {
    /// The body of an async function: `return` gives the result.
    script: String,
    /// A window label; the first app window when absent.
    #[serde(default)]
    window: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

/// Runs the script and answers with what it returned, once its promise settles.
pub(super) async fn window_eval(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<WindowEval>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let view = match person_window(&bridge.app, body.window.as_deref()) {
        Ok(view) => view,
        Err(error) => return reply(Err(error)),
    };
    let wait = body
        .timeout_ms
        .map_or(DEFAULT_WAIT, Duration::from_millis)
        .min(MAX_WAIT);
    reply(run(&view, &body.script, wait).await)
}

/// Windows with the full interface.
fn is_person_window(label: &str) -> bool {
    label.starts_with("window-")
}

fn person_window(app: &AppHandle, named: Option<&str>) -> Result<Webview, String> {
    if let Some(label) = named {
        if !is_person_window(label) {
            return Err(format!("{label} is not a person's window."));
        }
        return app
            .get_webview(label)
            .ok_or_else(|| format!("{label} is not open."));
    }
    let mut labels: Vec<String> = app
        .webviews()
        .into_keys()
        .filter(|label| label.starts_with("window-"))
        .collect();
    labels.sort();
    labels
        .first()
        .and_then(|label| app.get_webview(label))
        .ok_or_else(|| "No Misty window is open.".to_owned())
}

/// Starts the script without waiting on it, because a callback only sees a synchronous result,
/// then looks at its slot until it settles.
async fn run(view: &Webview, script: &str, wait: Duration) -> Result<Value, String> {
    let slot = uuid::Uuid::new_v4().to_string();
    let started = look(view, start_script(&slot, script)).await?;
    if started != Value::Bool(true) {
        return Err(format!("The window did not start the script: {started}"));
    }
    let deadline = tokio::time::Instant::now() + wait;
    while tokio::time::Instant::now() < deadline {
        tokio::time::sleep(POLL).await;
        let answer = match look(view, poll_script(&slot)).await {
            Ok(answer) => answer,
            // Busy for a moment, which a long synchronous task makes it. The deadline still holds.
            Err(_) => continue,
        };
        match answer.as_str() {
            Some("pending") => {}
            Some("lost") => return Err("The window reloaded before the script finished.".into()),
            Some(text) => return settled(text),
            None => return Err(format!("Unexpected answer from the window: {answer}")),
        }
    }
    Err("The script did not finish in time.".into())
}

fn settled(text: &str) -> Result<Value, String> {
    let outcome: Value = serde_json::from_str(text).map_err(|error| error.to_string())?;
    if outcome["ok"] == json!(true) {
        Ok(outcome.get("value").cloned().unwrap_or(Value::Null))
    } else {
        Err(outcome["error"].as_str().unwrap_or("failed").to_owned())
    }
}

async fn look(view: &Webview, script: String) -> Result<Value, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    view.eval_with_callback(script, move |value| {
        if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
            let _ = sender.send(value);
        }
    })
    .map_err(|error| error.to_string())?;
    let raw = tokio::time::timeout(LOOK, receiver)
        .await
        .map_err(|_| "The window did not answer.".to_owned())?
        .map_err(|_| "The window went away.".to_owned())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn start_script(slot: &str, script: &str) -> String {
    let slot = json!(slot);
    format!(
        "(() => {{ \
           const slots = (window.__mistyBridgeSlots ??= {{}}); \
           const slot = (slots[{slot}] = {{ state: 'pending' }}); \
           (async () => {{ {script}\n }})().then( \
             (value) => {{ slot.state = 'done'; slot.outcome = {{ ok: true, value: value === undefined ? null : value }}; }}, \
             (error) => {{ slot.state = 'done'; slot.outcome = {{ ok: false, error: String(error && error.message || error) }}; }}); \
           return true; \
         }})()"
    )
}

fn poll_script(slot: &str) -> String {
    let slot = json!(slot);
    format!(
        "(() => {{ \
           const slot = window.__mistyBridgeSlots && window.__mistyBridgeSlots[{slot}]; \
           if (!slot) return 'lost'; \
           if (slot.state === 'pending') return 'pending'; \
           delete window.__mistyBridgeSlots[{slot}]; \
           try {{ return JSON.stringify(slot.outcome); }} \
           catch (error) {{ return JSON.stringify({{ ok: false, error: String(error) }}); }} \
         }})()"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_persons_windows_can_be_reached() {
        assert!(is_person_window("window-0"));
        assert!(!is_person_window("incognito-3"));
        assert!(!is_person_window("misty-browser-abc"));
        assert!(!is_person_window("misty-cursor-0"));
    }

    #[test]
    fn a_settled_outcome_becomes_its_value_or_its_error() {
        assert_eq!(
            settled(r#"{"ok":true,"value":{"a":1}}"#).unwrap(),
            json!({"a":1})
        );
        assert_eq!(settled(r#"{"ok":true}"#).unwrap(), Value::Null);
        assert_eq!(settled(r#"{"ok":false,"error":"no"}"#).unwrap_err(), "no");
    }

    #[test]
    fn the_scripts_address_the_same_slot_and_keep_the_body_async() {
        let start = start_script("a\"b", "return await 1");
        assert!(start.contains(r#"slots["a\"b"]"#));
        assert!(start.contains("(async () => { return await 1\n })()"));
        assert!(poll_script("a\"b").contains(r#"__mistyBridgeSlots["a\"b"]"#));
    }
}
