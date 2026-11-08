use super::*;
use serde_json::json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[test]
fn a_key_prefix_names_its_provider() {
    for (key, provider) in [
        ("sk-ant-api03-abc", "anthropic"),
        ("sk-or-v1-abc", "openrouter"),
        ("sk-proj-abc", "openai"),
        ("sk-svcacct-abc", "openai"),
        ("sk-abc123", "openai"),
        ("  AIzaSyA-abc ", "google"),
        ("nvapi-abc", "nvidia"),
        ("vck_abc", "gateway"),
        ("3f9c2a7d1e.Zm9vYmFy", "ollama-cloud"),
    ] {
        assert_eq!(candidates(key), vec![provider], "{key}");
    }
    assert!(
        candidates("sk_elevenlabs").is_empty(),
        "voice keys go under Voice"
    );
}

#[test]
fn reads_each_providers_model_list() {
    let openai = json!({"data": [{"id": "gpt-5.5"}, {"id": "text-embedding-3-small"}]});
    assert_eq!(
        parse("openai", &openai),
        vec![
            ModelInfo {
                id: "openai/gpt-5.5".into(),
                label: "gpt-5.5".into(),
                embedding: false
            },
            ModelInfo {
                id: "openai/text-embedding-3-small".into(),
                label: "text-embedding-3-small".into(),
                embedding: true
            },
        ]
    );
    let anthropic =
        json!({"data": [{"id": "claude-sonnet-5-5", "display_name": "Claude Sonnet 5.5"}]});
    assert_eq!(parse("anthropic", &anthropic)[0].label, "Claude Sonnet 5.5");
    let google = json!({"models": [
        {"name": "models/gemini-3-flash", "displayName": "Gemini 3 Flash", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/gemini-embedding-001", "supportedGenerationMethods": ["embedContent"]},
        {"name": "models/aqa", "supportedGenerationMethods": ["generateAnswer"]},
    ]});
    let google = parse("google", &google);
    assert_eq!(
        google.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        ["google/gemini-3-flash", "google/gemini-embedding-001"]
    );
    assert!(google[1].embedding);
    let ollama = json!({"models": [{"name": "gpt-oss:120b"}, {"name": "nomic-embed-text"}]});
    assert_eq!(
        parse("ollama-cloud", &ollama)[0].id,
        "ollama-cloud/gpt-oss:120b"
    );
    assert!(parse("ollama", &ollama)[1].embedding);
    let chatgpt = json!({"models": [
        {"slug": "gpt-6.1-sol", "display_name": "GPT-6.1 Sol", "visibility": "list"},
        {"slug": "internal", "display_name": "Hidden", "visibility": "hide"},
    ]});
    assert_eq!(
        parse("chatgpt", &chatgpt),
        vec![ModelInfo {
            id: "chatgpt/gpt-6.1-sol".into(),
            label: "GPT-6.1 Sol".into(),
            embedding: false
        }]
    );
    let gateway = json!({"data": [{"id": "openai/text-embedding-3-small", "name": "Embedding", "type": "embedding"}]});
    assert!(parse("gateway", &gateway)[0].embedding);
}

#[test]
fn local_servers_list_at_the_devices_address() {
    assert_eq!(
        listing("ollama", Some("http://127.0.0.1:11434/v1/"))
            .unwrap()
            .url,
        "http://127.0.0.1:11434/api/tags"
    );
    assert_eq!(
        listing("openai-compatible", Some("http://127.0.0.1:8000/v1"))
            .unwrap()
            .url,
        "http://127.0.0.1:8000/v1/models"
    );
    assert!(listing("ollama", None).is_none());
    assert_eq!(
        listing("ollama-cloud", None).unwrap().url,
        "https://ollama.com/api/tags"
    );
}

/// Answers every request with `status`, and with a model list when the key is `good-key`.
async fn fake_provider() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let mut buffer = [0u8; 4096];
            let n = stream.read(&mut buffer).await.unwrap_or(0);
            let head = String::from_utf8_lossy(&buffer[..n]).to_lowercase();
            let (status, body) = if head.contains("authorization: bearer good-key") {
                ("200 OK", json!({"data": [{"id": "model-a"}]}).to_string())
            } else {
                ("401 Unauthorized", json!({"error": "bad key"}).to_string())
            };
            let reply = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = stream.write_all(reply.as_bytes()).await;
        }
    });
    base
}

#[tokio::test]
async fn listing_with_the_key_confirms_it() {
    let base = fake_provider().await;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let http = reqwest::Client::builder().no_proxy().build().unwrap();
    let at = |verify: bool| Listing {
        url: format!("{base}/v1/models"),
        auth: Auth::Bearer,
        headers: Vec::new(),
        verify: verify.then(|| format!("{base}/v1/key")),
    };
    let models = list(&http, "openrouter", &at(true), "good-key")
        .await
        .unwrap();
    assert_eq!(models[0].id, "openrouter/model-a");
    assert_eq!(
        list(&http, "openrouter", &at(true), "bad-key").await,
        Err(ListError::Rejected)
    );
    assert_eq!(
        list(&http, "openai", &at(false), "bad-key").await,
        Err(ListError::Rejected)
    );
}
