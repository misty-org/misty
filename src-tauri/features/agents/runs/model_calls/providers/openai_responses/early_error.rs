//! OpenAI can answer 200 and then fail before writing anything, such as for `insufficient_quota`.
//! That is the call failing, so it's reported as a failed request rather than inside the stream.
//! Ported from `openai-stream-error.ts`.
use std::time::Duration;

use futures_util::{stream, StreamExt};
use serde_json::Value;

use super::chunk::{is_output_chunk, read_chunk, Chunk, Known};
use crate::model_calls::error::{retryable_status, scrub, ModelError};
use crate::model_calls::model::BodyStream;
use crate::model_calls::sse::SseDecoder;

/// How long to keep looking for a failure once OpenAI has said it's working on the request. A
/// failure flushed along with that event still counts, and a healthy stream isn't held up.
const ACCEPTED_GRACE: Duration = Duration::from_millis(50);

enum Verdict {
    KeepLooking { accepted: bool },
    Healthy,
    Failed(ModelError),
}

fn status_for(code: Option<&str>, kind: Option<&str>) -> u16 {
    if let Some(code) = code.filter(|code| code.len() == 3).and_then(|code| code.parse::<u16>().ok()) {
        if (400..=599).contains(&code) {
            return code;
        }
    }
    let discriminator = [code, kind].into_iter().flatten().collect::<Vec<_>>().join(" ").to_lowercase();
    let has = |term: &str| discriminator.contains(term);
    if has("insufficient_quota") || has("rate_limit") {
        429
    } else if has("authentication") {
        401
    } else if has("permission") {
        403
    } else if has("not_found") {
        404
    } else if has("invalid") || has("bad_request") || has("context_length") {
        400
    } else if has("overload") {
        503
    } else if has("timeout") {
        504
    } else {
        500
    }
}

fn api_failure(message: &str, code: Option<&str>, kind: Option<&str>, secret: &str) -> ModelError {
    let status = status_for(code, kind);
    ModelError::Api {
        status,
        message: scrub(message, secret),
        retryable: retryable_status(status),
        retry_after_ms: None,
    }
}

fn error_frame_failure(frame: &Value, secret: &str) -> ModelError {
    let error = frame.get("error").filter(|error| error.is_object()).unwrap_or(frame);
    let text = |name: &str| error.get(name).and_then(Value::as_str);
    api_failure(text("message").unwrap_or_default(), text("code"), text("type"), secret)
}

fn judge(event: &str, accepted: bool, secret: &str) -> Verdict {
    if event == "[DONE]" {
        return Verdict::KeepLooking { accepted };
    }
    // A chunk that can't be read goes on to the consumer, as an error part.
    let Ok(value) = serde_json::from_str::<Value>(event) else {
        return Verdict::Healthy;
    };
    let Some(chunk) = read_chunk(&value) else {
        return Verdict::Healthy;
    };
    if let Chunk::ErrorFrame(frame) = &chunk {
        return Verdict::Failed(error_frame_failure(frame, secret));
    }
    if let Chunk::Known(known) = &chunk {
        if let Known::Failed { response, .. } = &**known {
            if let Some(error) = &response.error {
                return Verdict::Failed(api_failure(&error.message, error.code.as_deref(), Some("response.failed"), secret));
            }
        }
        if matches!(**known, Known::InProgress { .. }) {
            return Verdict::KeepLooking { accepted: true };
        }
    }
    if is_output_chunk(&chunk) {
        return Verdict::Healthy;
    }
    Verdict::KeepLooking { accepted }
}

/// Reads the start of a body, and returns all of it again unless it was an early failure.
pub(super) async fn throw_if_stream_error_before_output(mut body: BodyStream, secret: &str) -> Result<BodyStream, ModelError> {
    let mut read: Vec<u8> = Vec::new();
    let mut events = SseDecoder::default();
    let mut accepted = false;
    loop {
        let next = if accepted {
            match tokio::time::timeout(ACCEPTED_GRACE, body.next()).await {
                Ok(next) => next,
                Err(_) => break,
            }
        } else {
            body.next().await
        };
        let (complete, ended) = match next {
            Some(Ok(bytes)) => {
                read.extend_from_slice(&bytes);
                (events.push(&bytes), false)
            }
            Some(Err(message)) => return Err(ModelError::Network(scrub(&message, secret))),
            None => (Vec::new(), true),
        };
        for event in complete {
            match judge(&event, accepted, secret) {
                Verdict::KeepLooking { accepted: now } => accepted = now,
                Verdict::Healthy => return Ok(replayed(read, body)),
                Verdict::Failed(error) => return Err(error),
            }
        }
        if ended {
            // The body is finished, and mustn't be asked for more.
            return Ok(replayed(read, Box::pin(stream::empty())));
        }
    }
    Ok(replayed(read, body))
}

fn replayed(read: Vec<u8>, body: BodyStream) -> BodyStream {
    Box::pin(stream::once(async move { Ok(read) }).chain(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_come_from_the_code_or_its_words() {
        assert_eq!(status_for(Some("503"), None), 503);
        assert_eq!(status_for(Some("200"), None), 500);
        assert_eq!(status_for(Some("insufficient_quota"), Some("insufficient_quota")), 429);
        assert_eq!(status_for(Some("rate_limit_exceeded"), Some("response.failed")), 429);
        assert_eq!(status_for(None, Some("authentication_error")), 401);
        assert_eq!(status_for(Some("permission_denied"), None), 403);
        assert_eq!(status_for(Some("model_not_found"), None), 404);
        assert_eq!(status_for(Some("context_length_exceeded"), None), 400);
        assert_eq!(status_for(None, Some("invalid_request_error")), 400);
        assert_eq!(status_for(Some("server_overloaded"), None), 503);
        assert_eq!(status_for(Some("timeout"), None), 504);
        assert_eq!(status_for(Some("server_error"), Some("response.failed")), 500);
    }

    fn body_of(parts: Vec<&'static str>) -> BodyStream {
        Box::pin(stream::iter(parts.into_iter().map(|part| Ok(part.as_bytes().to_vec()))))
    }

    async fn all(body: BodyStream) -> String {
        let chunks: Vec<_> = body.collect().await;
        chunks.into_iter().map(|chunk| String::from_utf8(chunk.unwrap()).unwrap()).collect()
    }

    const CREATED: &str = "data: {\"type\":\"response.created\",\"response\":{\"id\":\"r\",\"created_at\":1,\"model\":\"m\"}}\n\n";
    const PROGRESS: &str = "data: {\"type\":\"response.in_progress\",\"response\":{\"id\":\"r\",\"created_at\":1,\"model\":\"m\"}}\n\n";
    const QUOTA: &str = "data: {\"type\":\"error\",\"sequence_number\":2,\"error\":{\"type\":\"insufficient_quota\",\"code\":\"insufficient_quota\",\"message\":\"Over quota for key secret-key-1\"}}\n\n";
    const OUTPUT: &str = "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"i\",\"delta\":\"a\"}\n\n";

    #[tokio::test]
    async fn a_failure_after_being_accepted_still_fails_the_call() {
        let found = throw_if_stream_error_before_output(body_of(vec![CREATED, PROGRESS, QUOTA]), "secret-key-1").await;
        match found.err().unwrap() {
            ModelError::Api { status, message, retryable, .. } => {
                assert_eq!(status, 429);
                assert_eq!(message, "Over quota for key [redacted]");
                assert!(retryable);
            }
            other => panic!("{other}"),
        }
    }

    #[tokio::test]
    async fn everything_read_comes_back_once_output_starts() {
        let body = throw_if_stream_error_before_output(body_of(vec![CREATED, OUTPUT, QUOTA]), "k").await.unwrap();
        assert_eq!(all(body).await, format!("{CREATED}{OUTPUT}{QUOTA}"));
    }

    #[tokio::test]
    async fn a_quiet_stream_is_released_after_the_grace_period() {
        // The body never ends after this, so only the grace period can release it.
        let body: BodyStream = Box::pin(
            stream::iter(vec![Ok(PROGRESS.as_bytes().to_vec())]).chain(stream::pending()),
        );
        let released = tokio::time::timeout(
            Duration::from_secs(5),
            throw_if_stream_error_before_output(body, "k"),
        )
        .await;
        assert!(released.unwrap().is_ok());
    }
}
