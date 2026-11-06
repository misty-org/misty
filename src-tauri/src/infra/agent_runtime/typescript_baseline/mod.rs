//! DELETE THIS FILE WHEN THE RUST RUNTIME HAS MATCHED THE BASELINE (docs/plans/app-permissions.md).
//!
//! Debug builds only, and only with `MISTY_AGENT_RUNTIME=typescript`: the old path, starting the
//! TypeScript runtime from the checkout under Node and signing HTTP calls to it, so Odysseys can
//! record its baseline. It's why Node is still installed anywhere, and it isn't in any release. Voice
//! and live transcription aren't here: benchmarks don't use them, and their sockets are gone.
mod process;

use std::{
    sync::{Mutex, OnceLock, PoisonError},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::calls::{origin, CallReply, Delivery, Outcome};
use process::{start, Running};

static RUNNING: tokio::sync::Mutex<Option<Running>> = tokio::sync::Mutex::const_new(None);
static APP: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);

/// Whether this launch uses it. Fixed at the first answer, so one launch can't mix the two.
pub(super) fn selected() -> bool {
    static SELECTED: OnceLock<bool> = OnceLock::new();
    *SELECTED.get_or_init(|| std::env::var("MISTY_AGENT_RUNTIME").as_deref() == Ok("typescript"))
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(600))
            .build()
            .unwrap_or_default()
    })
}

fn hmac(key: &[u8], message: &[u8]) -> [u8; 32] {
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

/// One signed POST, as `signature.ts` checks it; the status and the JSON body, if any.
async fn post(
    (base, secret): &(String, Vec<u8>),
    path: &str,
    idempotency: &str,
    body: Vec<u8>,
) -> Result<(u16, Value), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs()
        .to_string();
    let digest = hex::encode(Sha256::digest(&body));
    let signed = format!("POST\n{path}\n{timestamp}\n{digest}");
    let response = client()
        .post(format!("{base}{path}"))
        .header("content-type", "application/json")
        .header("x-misty-agent-timestamp", &timestamp)
        .header(
            "x-misty-agent-signature",
            hex::encode(hmac(secret, signed.as_bytes())),
        )
        .header("idempotency-key", idempotency)
        .body(body)
        .send()
        .await
        .map_err(|_| "Misty's agent runtime didn't answer.".to_string())?;
    let status = response.status().as_u16();
    Ok((
        status,
        response.json::<Value>().await.unwrap_or(Value::Null),
    ))
}

async fn push_models(app: &tauri::AppHandle, address: &(String, Vec<u8>)) -> Result<(), String> {
    let document = crate::infra::models::current_document(app)
        .await
        .unwrap_or_else(|| json!({}));
    let body = serde_json::to_vec(&document).map_err(|error| error.to_string())?;
    let (status, _) = post(address, "/v1/local/models", "models", body).await?;
    (200..300)
        .contains(&status)
        .then_some(())
        .ok_or_else(|| "Misty couldn't give its agent runtime this device's models.".into())
}

async fn ensure(app: &tauri::AppHandle) -> Result<(String, Vec<u8>), String> {
    *APP.lock().unwrap_or_else(PoisonError::into_inner) = Some(app.clone());
    let mut running = RUNNING.lock().await;
    if let Some(current) = running.as_mut() {
        if matches!(current.child.try_wait(), Ok(None)) {
            return Ok((current.base.clone(), current.secret.clone()));
        }
    }
    let started = start().await?;
    let address = (started.base.clone(), started.secret.clone());
    *running = Some(started);
    drop(running);
    push_models(app, &address).await?;
    Ok(address)
}

fn segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

pub(super) async fn deliver(
    app: &tauri::AppHandle,
    delivery: &Delivery,
    server: &str,
) -> Result<Outcome, String> {
    let address = ensure(app).await?;
    let run = &delivery.run_id;
    let (path, idempotency, body) = match delivery.operation.as_str() {
        "invocation.start" => (
            "/v1/runs".to_owned(),
            run.clone(),
            json!({
                "run_id": run,
                "callback_url": origin(server)?,
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
    let body = serde_json::to_vec(&body).map_err(|error| error.to_string())?;
    let (status, value) = post(&address, &path, &idempotency, body).await?;
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

/// The body goes as the renderer wrote it, as it does to the Rust runtime, so a comparison between
/// the two isn't a comparison of key orders.
pub(super) async fn call(
    app: &tauri::AppHandle,
    name: &str,
    body: String,
) -> Result<CallReply, String> {
    let address = ensure(app).await?;
    let idempotency = format!("{name}:{}", rand::random::<u64>());
    let path = format!("/v1/device/{name}");
    let (status, body) = post(&address, &path, &idempotency, body.into_bytes()).await?;
    Ok(CallReply { status, body })
}

pub(super) fn models_changed() {
    if !selected() {
        return;
    }
    let Some(app) = APP.lock().unwrap_or_else(PoisonError::into_inner).clone() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let address = {
            let mut running = RUNNING.lock().await;
            let Some(current) = running.as_mut() else {
                return;
            };
            if !matches!(current.child.try_wait(), Ok(None)) {
                return;
            }
            (current.base.clone(), current.secret.clone())
        };
        if let Err(error) = push_models(&app, &address).await {
            eprintln!("Could not give the agent runtime this device's models: {error}");
        }
    });
}

pub(super) fn stop() {
    if let Ok(mut running) = RUNNING.try_lock() {
        if let Some(current) = running.as_mut() {
            let _ = current.child.start_kill();
        }
        *running = None;
    }
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
}
