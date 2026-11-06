//! Signed calls to the agent runtime on this computer, and the deliveries the server queues
//! for it. The signature is the one the runtime checks for every `/v1` call
//! (`src-tauri/services/agent-runtime/src/signature.ts`): HMAC-SHA256 over the method, path,
//! timestamp and the body's SHA-256.
use std::{
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            // A Library recording may take minutes to transcribe.
            .timeout(Duration::from_secs(600))
            .build()
            .unwrap_or_default()
    })
}

pub(super) fn hmac(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    if key.len() > 64 {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let pad = |byte: u8| block.map(|value| value ^ byte);
    let inner = Sha256::new()
        .chain_update(pad(0x36))
        .chain_update(message)
        .finalize();
    Sha256::new()
        .chain_update(pad(0x5c))
        .chain_update(inner)
        .finalize()
        .into()
}

pub(super) fn signature(
    secret: &[u8],
    method: &str,
    path: &str,
    timestamp: &str,
    body: &[u8],
) -> String {
    let digest = hex::encode(Sha256::digest(body));
    hex::encode(hmac(
        secret,
        format!("{}\n{path}\n{timestamp}\n{digest}", method.to_uppercase()).as_bytes(),
    ))
}

pub(super) async fn healthy(base: &str) -> bool {
    client()
        .get(format!("{base}/health"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

/// One signed POST; the status and the JSON body, if any.
pub(super) async fn post(
    base: &str,
    secret: &[u8],
    path: &str,
    idempotency: &str,
    body: &Value,
) -> Result<(u16, Value), String> {
    let body = serde_json::to_vec(body).map_err(|error| error.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs()
        .to_string();
    let response = client()
        .post(format!("{base}{path}"))
        .header("content-type", "application/json")
        .header("x-misty-agent-timestamp", &timestamp)
        .header(
            "x-misty-agent-signature",
            signature(secret, "POST", path, &timestamp, &body),
        )
        .header("idempotency-key", idempotency)
        .body(body)
        .send()
        .await
        .map_err(|_| "Misty's agent runtime didn't answer.".to_string())?;
    let status = response.status().as_u16();
    let value = response.json::<Value>().await.unwrap_or(Value::Null);
    Ok((status, value))
}

/// A delivery as the server hands it over (`agent_runtime_device.go`).
#[derive(Deserialize)]
pub struct Delivery {
    operation: String,
    run_id: String,
    #[serde(default)]
    runtime_run_id: String,
    #[serde(default)]
    hook_token: String,
    #[serde(default)]
    available: bool,
    #[serde(default)]
    run_key: String,
    #[serde(default)]
    adapter_version: String,
    #[serde(default)]
    receipt_callback: String,
}

/// What the runtime did, for the server's finish call.
#[derive(Serialize, Default)]
pub struct Outcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

/// The server's origin: the runtime calls its run routes at `/internal/agent-runtime/…`.
fn origin(server: &str) -> Result<String, String> {
    let url = url::Url::parse(server).map_err(|_| "Invalid API URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Invalid API URL".into());
    }
    Ok(url.origin().ascii_serialization())
}

/// Hands one delivery to the agent runtime on this computer, starting it when needed.
#[tauri::command]
pub async fn agent_runtime_deliver(
    app: tauri::AppHandle,
    delivery: Delivery,
    server: String,
) -> Result<Outcome, String> {
    let (base, secret) = super::ensure(&app).await?;
    let run = &delivery.run_id;
    let (path, idempotency, body) = match delivery.operation.as_str() {
        "invocation.start" => (
            "/v1/runs".to_owned(),
            run.clone(),
            json!({
                "run_id": run,
                "callback_url": origin(&server)?,
                "adapter_version": delivery.adapter_version,
                "run_key": delivery.run_key,
                "receipt_callback": delivery.receipt_callback,
            }),
        ),
        "runtime.cancel" => (
            format!("/v1/runs/{}/cancel", segment(&delivery.runtime_run_id)),
            format!("{run}:cancel"),
            json!({}),
        ),
        "runtime.reconcile" => (
            format!("/v1/runs/{}/status", segment(&delivery.runtime_run_id)),
            format!("{run}:status"),
            json!({}),
        ),
        "device.resume" | "intervention.resume" => (
            format!("/v1/devices/{}", segment(&delivery.hook_token)),
            format!(
                "{run}:device:{}:{}",
                hex::encode(Sha256::digest(delivery.hook_token.as_bytes())),
                delivery.available
            ),
            json!({ "available": delivery.available }),
        ),
        _ => return Err("Misty doesn't know this agent runtime delivery.".into()),
    };
    let (status, value) = post(&base, &secret, &path, &idempotency, &body).await?;
    let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
    if !(200..300).contains(&status) {
        return Ok(Outcome {
            error: Some(text("code").unwrap_or_else(|| format!("agent_runtime_{status}"))),
            ..Outcome::default()
        });
    }
    Ok(Outcome {
        runtime_run_id: text("runtime_run_id"),
        status: text("status"),
        error: None,
    })
}

/// The model calls the desktop makes outside agent runs on its own runtime
/// (`src-tauri/services/agent-runtime/src/device-calls.ts`, `device-routing.ts`).
const DEVICE_CALLS: [&str; 12] = [
    "cleanup",
    "voice-transcription",
    "screen-model",
    "refine-point",
    "extract",
    "embed",
    "day-summary",
    "voice-notes",
    "transcribe-diarized",
    // Settings › Models' check that the agent model calls tools and sees screenshots.
    "model-test",
    // Where a message to a busy agent goes, and a page-state restore's next step
    // (`src/device-routing.ts`).
    "follow-up",
    "restore-step",
];

/// What a device call answered: its status and body, so the renderer can tell a missing key
/// from a provider failure.
#[derive(Serialize)]
pub struct CallReply {
    status: u16,
    body: Value,
}

/// One model call on this computer's runtime, with this device's models and keys.
#[tauri::command]
pub async fn agent_runtime_call(
    app: tauri::AppHandle,
    name: String,
    body: Value,
) -> Result<CallReply, String> {
    if !DEVICE_CALLS.contains(&name.as_str()) {
        return Err("Misty doesn't know this model call.".into());
    }
    let (base, secret) = super::ensure(&app).await?;
    let idempotency = format!("{name}:{}", rand::random::<u64>());
    let (status, body) = post(
        &base,
        &secret,
        &format!("/v1/device/{name}"),
        &idempotency,
        &body,
    )
    .await?;
    Ok(CallReply { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_like_the_runtime() {
        // RFC 4231 test case 2.
        assert_eq!(
            hex::encode(hmac(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        let long = [0xaa_u8; 131];
        assert_eq!(
            hex::encode(hmac(
                &long,
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn calls_the_server_at_its_origin() {
        assert_eq!(
            origin("http://127.0.0.1:8081/v1").unwrap(),
            "http://127.0.0.1:8081"
        );
        assert_eq!(
            origin("https://misty.example.com/v1").unwrap(),
            "https://misty.example.com"
        );
        assert!(origin("file:///etc/passwd").is_err());
    }
}
