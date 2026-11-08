//! What the app and the confined worker say to each other. The worker's input is one line of JSON
//! with the call's settings and then the page's text as it is, since JSON would escape a page several
//! times larger. Its output is one JSON value. One process reads one page and exits.
use serde::{Deserialize, Serialize};

use crate::readable::{readable_page, ReadableError, ReadablePage};

/// Bumped with any change here. The worker is embedded in the app, so the two always match, and this
/// catches a build that somehow mixed them.
pub const PROTOCOL: u32 = 1;
/// A fetch keeps at most 2 MiB of a page, and decoding can make that text up to three times larger:
/// each byte a charset can't decode becomes a three-byte replacement character.
pub const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
/// The title isn't limited and JSON can escape it six times over, so this holds any answer to a page
/// the input limit lets through at its usual sizes, and refuses the rest plainly.
pub const MAX_ANSWER_BYTES: usize = 16 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Settings {
    protocol: u32,
    content_type: String,
    question: String,
    limit: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Answer {
    Page { protocol: u32, title: String, text: String, truncated: bool },
    NoDocumentElement { protocol: u32 },
    Refused { protocol: u32 },
}

/// Why an answer couldn't be used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProtocolError {
    TooLarge,
    Unreadable,
    /// The worker refused the input, which the app never sends on purpose.
    Refused,
}

/// The worker's whole input, or `TooLarge` past the limit.
pub fn encode_request(html: &str, content_type: &str, question: &str, limit: usize) -> Result<Vec<u8>, ProtocolError> {
    let settings = Settings { protocol: PROTOCOL, content_type: content_type.to_owned(), question: question.to_owned(), limit };
    let mut input = serde_json::to_vec(&settings).map_err(|_| ProtocolError::Unreadable)?;
    input.push(b'\n');
    input.extend_from_slice(html.as_bytes());
    if input.len() > MAX_INPUT_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    Ok(input)
}

fn read_request(input: &[u8]) -> Option<(Settings, &str)> {
    let end = input.iter().position(|byte| *byte == b'\n')?;
    let settings: Settings = serde_json::from_slice(&input[..end]).ok()?;
    let html = std::str::from_utf8(&input[end + 1..]).ok()?;
    (settings.protocol == PROTOCOL).then_some((settings, html))
}

/// What the worker does with its input: the page read by [`readable_page`], as JSON.
pub fn answer(input: &[u8]) -> Vec<u8> {
    let answer = match read_request(input) {
        None => Answer::Refused { protocol: PROTOCOL },
        Some((settings, html)) => match readable_page(html, &settings.content_type, &settings.question, settings.limit) {
            Ok(page) => Answer::Page { protocol: PROTOCOL, title: page.title, text: page.text, truncated: page.truncated },
            Err(ReadableError::NoDocumentElement) => Answer::NoDocumentElement { protocol: PROTOCOL },
        },
    };
    // Plain strings and numbers always serialize.
    serde_json::to_vec(&answer).unwrap_or_default()
}

/// The worker's output as what [`readable_page`] returned. The outer error is a reply that can't be
/// trusted to be an answer at all.
pub fn decode_answer(output: &[u8]) -> Result<Result<ReadablePage, ReadableError>, ProtocolError> {
    if output.len() > MAX_ANSWER_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    match serde_json::from_slice(output).map_err(|_| ProtocolError::Unreadable)? {
        Answer::Page { protocol: PROTOCOL, title, text, truncated } => Ok(Ok(ReadablePage { title, text, truncated })),
        Answer::NoDocumentElement { protocol: PROTOCOL } => Ok(Err(ReadableError::NoDocumentElement)),
        Answer::Refused { .. } => Err(ProtocolError::Refused),
        _ => Err(ProtocolError::Unreadable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_and_answer_read_a_page_as_the_function_does() {
        let page = "<html><head><title> Plans </title></head><body><h1>Pro</h1><p>$10\nnew line</p></body></html>";
        let input = encode_request(page, "text/html", "price", 500).unwrap();
        let read = decode_answer(&answer(&input)).unwrap().unwrap();
        assert_eq!(read, readable_page(page, "text/html", "price", 500).unwrap());
        assert_eq!(read.title, "Plans");
    }

    #[test]
    fn a_page_with_no_element_fails_the_same_way() {
        let input = encode_request("just words", "text/html", "", 500).unwrap();
        assert_eq!(decode_answer(&answer(&input)).unwrap(), Err(ReadableError::NoDocumentElement));
    }

    #[test]
    fn plain_text_passes_through() {
        let input = encode_request("{\"ok\":true}\n", "application/json", "", 500).unwrap();
        assert_eq!(decode_answer(&answer(&input)).unwrap().unwrap().text, "{\"ok\":true}");
    }

    #[test]
    fn nonsense_is_refused_and_never_read_as_a_page() {
        assert_eq!(decode_answer(&answer(b"no settings line")), Err(ProtocolError::Refused));
        assert_eq!(decode_answer(b"not json"), Err(ProtocolError::Unreadable));
        assert_eq!(decode_answer(br#"{"page":{"protocol":99,"title":"","text":"","truncated":false}}"#), Err(ProtocolError::Unreadable));
    }

    #[test]
    fn sizes_are_limited_both_ways() {
        let page = "x".repeat(MAX_INPUT_BYTES);
        assert_eq!(encode_request(&page, "text/html", "", 500), Err(ProtocolError::TooLarge));
        assert_eq!(decode_answer(&vec![b' '; MAX_ANSWER_BYTES + 1]), Err(ProtocolError::TooLarge));
    }
}
