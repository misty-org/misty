//! Live transcription on this computer: the app mints the one-time ticket the runtime's relay
//! (`server/apps/agent-runtime/src/live/`) checks, signed with this launch's secret, and the
//! relay streams to Soniox on the device's own key. Must match `ticket.ts`.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use serde_json::json;

const DOMAIN: &str = "misty-live-ticket\n";
const MODEL: &str = "soniox/stt-rt-v4";
/// A ticket must be used within a minute.
const TICKET_SECONDS: u64 = 60;
/// The longest one session may stream, across its channels.
const MAX_MS: u64 = 4 * 60 * 60 * 1000;

#[derive(Serialize)]
pub struct LiveTicket {
    ticket: String,
    url: String,
    expires_in: u64,
    max_ms: u64,
}

pub(super) fn mint(
    secret: &[u8],
    channels: &[String],
    language: &str,
    now: u64,
    model: &str,
) -> Result<String, String> {
    if channels.is_empty()
        || channels
            .iter()
            .any(|channel| channel != "mic" && channel != "system")
    {
        return Err("Choose the microphone, this computer's sound, or both.".into());
    }
    let mut sid = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut sid);
    let mut claims = json!({
        "sid": hex::encode(sid),
        "sub": "device",
        "dev": "local",
        "ch": channels,
        "max": MAX_MS,
        "model": model,
        "exp": now + TICKET_SECONDS,
    });
    if !language.is_empty() && language != "auto" && language.len() <= 16 {
        claims["lang"] = json!(language);
    }
    let encoded =
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).map_err(|error| error.to_string())?);
    let signature = hex::encode(super::calls::hmac(
        secret,
        format!("{DOMAIN}{encoded}").as_bytes(),
    ));
    Ok(format!("v1.{encoded}.{signature}"))
}

/// A ticket for one live transcription session on this computer's runtime.
#[tauri::command]
pub async fn agent_runtime_live_ticket(
    app: tauri::AppHandle,
    channels: Vec<String>,
    language: String,
) -> Result<LiveTicket, String> {
    let (base, secret) = super::ensure(&app).await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    Ok(LiveTicket {
        ticket: mint(&secret, &channels, &language, now, MODEL)?,
        url: format!(
            "{}/v1/live/transcribe",
            base.replacen("http://", "ws://", 1)
        ),
        expires_in: TICKET_SECONDS,
        max_ms: MAX_MS,
    })
}

/// What a voice ticket opens: the companion's spoken conversation (`src/voice/route.ts`),
/// never a live transcription session.
const VOICE_MODEL: &str = "misty/voice-conversation";

#[derive(Serialize)]
pub struct VoiceTicket {
    url: String,
}

/// The companion's spoken conversation on this computer's runtime: a one-time socket address.
#[tauri::command]
pub async fn agent_runtime_voice_ticket(app: tauri::AppHandle) -> Result<VoiceTicket, String> {
    let (base, secret) = super::ensure(&app).await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let ticket = mint(&secret, &["mic".into()], "", now, VOICE_MODEL)?;
    Ok(VoiceTicket {
        url: format!(
            "{}/v1/device/voice?ticket={}",
            base.replacen("http://", "ws://", 1),
            url::form_urlencoded::byte_serialize(ticket.as_bytes()).collect::<String>()
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mints_a_ticket_the_relay_can_check() {
        let ticket = mint(
            b"0123456789abcdef0123456789abcdef",
            &["mic".into()],
            "en",
            1_000,
            MODEL,
        )
        .unwrap();
        let parts: Vec<_> = ticket.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "v1");
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["ch"], json!(["mic"]));
        assert_eq!(claims["exp"], json!(1_060));
        assert_eq!(claims["lang"], json!("en"));
        assert_eq!(
            parts[2],
            hex::encode(super::super::calls::hmac(
                b"0123456789abcdef0123456789abcdef",
                format!("{DOMAIN}{}", parts[1]).as_bytes()
            ))
        );
        assert!(mint(b"k", &["camera".into()], "", 0, MODEL).is_err());
    }
}
