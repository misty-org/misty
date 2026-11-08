//! Posting a model call and reading a provider's failures.
use serde::Serialize;
use serde_json::Value;

use super::error::{retryable_status, scrub, ModelError};

/// Sends a JSON body, returning the response when the provider accepted it. `error_message` finds
/// the provider's own explanation in a JSON failure body.
pub(crate) async fn post_json<B: Serialize>(
    client: &reqwest::Client,
    url: &str,
    headers: &[(&str, String)],
    body: &B,
    secret: &str,
    error_message: fn(&Value) -> Option<String>,
) -> Result<reqwest::Response, ModelError> {
    let bytes = serde_json::to_vec(body)
        .map_err(|error| ModelError::Unsupported(format!("The request couldn't be built: {error}")))?;
    let mut request = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(bytes);
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let response = request
        .send()
        .await
        .map_err(|error| ModelError::Network(scrub(&error.to_string(), secret)))?;
    if response.status().is_success() {
        return Ok(response);
    }
    Err(failure(response, secret, error_message).await)
}

/// Sends a body of any kind, returning whatever the provider answered.
pub(crate) async fn post_body(
    client: &reqwest::Client,
    url: &str,
    headers: &[(&str, String)],
    content_type: &str,
    body: Vec<u8>,
    secret: &str,
) -> Result<reqwest::Response, ModelError> {
    let mut request = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(body);
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    request
        .send()
        .await
        .map_err(|error| ModelError::Network(scrub(&error.to_string(), secret)))
}

/// Reads a failed response into its error.
pub(crate) async fn failure(
    response: reqwest::Response,
    secret: &str,
    error_message: fn(&Value) -> Option<String>,
) -> ModelError {
    let status = response.status();
    let retry_after_ms = retry_after(response.headers());
    let reason = status.canonical_reason().unwrap_or("Request failed").to_owned();
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| error_message(&value))
        .unwrap_or(reason);
    ModelError::Api {
        status: status.as_u16(),
        message: scrub(&message, secret),
        retryable: retryable_status(status.as_u16()),
        retry_after_ms,
    }
}

/// `parseFloat`: the number a text starts with, ignoring what follows.
fn leading_number(text: &str) -> Option<f64> {
    let text = text.trim_start();
    let mut end = 0;
    let mut seen_dot = false;
    for (at, character) in text.char_indices() {
        let fits = character.is_ascii_digit()
            || (at == 0 && matches!(character, '+' | '-'))
            || (character == '.' && !seen_dot);
        if !fits {
            break;
        }
        seen_dot |= character == '.';
        end = at + character.len_utf8();
    }
    text[..end].parse().ok()
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

/// How long a provider asked callers to wait, as the SDK reads it in `getRetryDelayInMs`: in
/// milliseconds, in seconds, or until a date. A negative wait counts as none.
pub(crate) fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok()).filter(|value| !value.is_empty());
    if let Some(ms) = header("retry-after-ms").and_then(leading_number) {
        return (ms >= 0.0).then_some(ms as u64);
    }
    let value = header("retry-after")?;
    let ms = match leading_number(value) {
        Some(seconds) => seconds * 1000.0,
        None => chrono::DateTime::parse_from_rfc2822(value).ok()?.timestamp_millis() as f64 - now_ms(),
    };
    (ms >= 0.0).then_some(ms as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(*name, HeaderValue::from_str(value).unwrap());
        }
        map
    }

    #[test]
    fn retry_after_reads_as_the_sdk_does() {
        assert_eq!(retry_after(&headers(&[("retry-after-ms", "1500")])), Some(1500));
        assert_eq!(retry_after(&headers(&[("retry-after", "2")])), Some(2000));
        assert_eq!(retry_after(&headers(&[("retry-after", "2.5 seconds")])), Some(2500));
        assert_eq!(retry_after(&headers(&[("retry-after-ms", "100"), ("retry-after", "2")])), Some(100));
        assert_eq!(retry_after(&headers(&[("retry-after-ms", "nope"), ("retry-after", "2")])), Some(2000));
        assert_eq!(retry_after(&headers(&[("retry-after", "-1")])), None);
        assert_eq!(retry_after(&headers(&[("retry-after", "Wed, 21 Oct 2015 07:28:00 GMT")])), None, "a date in the past");
        assert_eq!(retry_after(&headers(&[("retry-after", "soon")])), None);
        assert_eq!(retry_after(&headers(&[])), None);
        let later = chrono::DateTime::from_timestamp((now_ms() / 1000.0) as i64 + 30, 0).unwrap().to_rfc2822();
        let waited = retry_after(&headers(&[("retry-after", later.as_str())])).unwrap();
        assert!(waited > 25_000 && waited <= 30_000, "{waited}");
    }
}
