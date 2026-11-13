//! The first user turn: the request plus its supplied files and screen captures.
use crate::model_calls::{FileData, Message, UserPart};

use super::{
    companion_images::{companion_image_parts, DisplayCapture, TaskFile},
    js_json::number_text,
    tool_transport::{object, string},
};

/// The parts of a run's context that go into its first turn (`SpaceTaskContext`).
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct TaskInput<'a> {
    pub(crate) prompt: &'a str,
    pub(crate) attachments: &'a [TaskFile],
    pub(crate) capture: Option<&'a TaskFile>,
    pub(crate) display_captures: &'a [DisplayCapture],
}

/// `Buffer.from(text, "base64")`, which skips what isn't base64 and takes the URL-safe alphabet too.
fn decode_base64(text: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() / 4 * 3);
    let mut bits = 0u32;
    let mut count = 0u32;
    for byte in text.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            _ => continue,
        };
        bits = (bits << 6) | u32::from(value);
        count += 6;
        if count >= 8 {
            count -= 8;
            bytes.push(((bits >> count) & 0xFF) as u8);
        }
    }
    bytes
}

/// What the AI SDK does with a data URL: the base64 after the comma, and the media type it names.
fn file_part(data_url: &str, media_type: &str) -> UserPart {
    let (header, data) = data_url.split_once(',').unwrap_or((data_url, ""));
    let data = data.split(',').next().unwrap_or(data);
    let named = header.split(';').next().and_then(|kind| kind.split(':').nth(1));
    UserPart::File {
        data: FileData::Data { data: data.to_owned() },
        media_type: named.unwrap_or(media_type).to_owned(),
    }
}

pub(crate) fn initial_messages(input: &TaskInput<'_>) -> Vec<Message> {
    let files = input.attachments.iter().chain(input.capture);
    if files.clone().next().is_none() && input.display_captures.is_empty() {
        return vec![Message::User {
            content: vec![UserPart::Text { text: input.prompt.to_owned() }],
            provider_options: None,
        }];
    }
    let manifest = input
        .attachments
        .iter()
        .map(|file| object([("attachmentId", string(&file.id)), ("name", string(&file.name)), ("mimeType", string(&file.mime_type))]).stringify())
        .collect::<Vec<_>>()
        .join("\n");
    let mut content = vec![UserPart::Text {
        text: format!("{}\nSupplied task files (use these IDs for upload):\n{manifest}", input.prompt),
    }];
    content.extend(companion_image_parts(input.display_captures));
    for file in files {
        match file.mime_type.as_str() {
            "text/plain" => {
                let encoded = file.data_url.split(',').nth(1).unwrap_or("");
                let text = String::from_utf8_lossy(&decode_base64(encoded)).into_owned();
                content.push(UserPart::Text { text: format!("Attachment {}:\n{text}", file.name) });
            }
            // The SDK's file part also carries the file's name, and `UserPart::File` has no field for it yet.
            "application/pdf" => content.push(file_part(&file.data_url, "application/pdf")),
            _ => {
                content.push(UserPart::Text {
                    text: format!("{} ({} x {} screenshot pixels; top-left origin)", file.name, number_text(file.width), number_text(file.height)),
                });
                content.push(file_part(&file.data_url, &file.mime_type));
            }
        }
    }
    vec![Message::User { content, provider_options: None }]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(id: &str, name: &str, mime: &str, data_url: &str) -> TaskFile {
        TaskFile {
            id: id.to_owned(),
            name: name.to_owned(),
            mime_type: mime.to_owned(),
            data_url: data_url.to_owned(),
            width: 4.0,
            height: 3.0,
            content_hash: "h".to_owned(),
        }
    }

    fn user_parts(messages: Vec<Message>) -> Vec<UserPart> {
        match messages.into_iter().next() {
            Some(Message::User { content, .. }) => content,
            other => panic!("expected a user message, got {other:?}"),
        }
    }

    #[test]
    fn a_plain_request_is_one_text_part() {
        let parts = user_parts(initial_messages(&TaskInput { prompt: "Go", ..TaskInput::default() }));
        assert_eq!(serde_json::to_string(&parts).unwrap(), r#"[{"type":"text","text":"Go"}]"#);
    }

    #[test]
    fn files_are_listed_and_follow_the_request() {
        let attachments = [
            file("a1", "notes.txt", "text/plain", "data:text/plain;base64,aMOpbGxv"),
            file("a2", "plan.pdf", "application/pdf", "data:application/pdf;base64,JVBERg=="),
            file("a3", "shot.png", "image/png", "data:image/png;base64,AAAA"),
        ];
        let capture = file("c", "screen", "image/webp", "data:image/webp;base64,BBBB");
        let parts = user_parts(initial_messages(&TaskInput { prompt: "Go", attachments: &attachments, capture: Some(&capture), display_captures: &[] }));
        assert_eq!(
            serde_json::to_value(&parts).unwrap(),
            serde_json::json!([
                { "type": "text", "text": "Go\nSupplied task files (use these IDs for upload):\n{\"attachmentId\":\"a1\",\"name\":\"notes.txt\",\"mimeType\":\"text/plain\"}\n{\"attachmentId\":\"a2\",\"name\":\"plan.pdf\",\"mimeType\":\"application/pdf\"}\n{\"attachmentId\":\"a3\",\"name\":\"shot.png\",\"mimeType\":\"image/png\"}" },
                { "type": "text", "text": "Attachment notes.txt:\nhéllo" },
                { "type": "file", "data": { "type": "data", "data": "JVBERg==" }, "mediaType": "application/pdf" },
                { "type": "text", "text": "shot.png (4 x 3 screenshot pixels; top-left origin)" },
                { "type": "file", "data": { "type": "data", "data": "AAAA" }, "mediaType": "image/png" },
                { "type": "text", "text": "screen (4 x 3 screenshot pixels; top-left origin)" },
                { "type": "file", "data": { "type": "data", "data": "BBBB" }, "mediaType": "image/webp" },
            ])
        );
    }

    #[test]
    fn base64_decodes_as_nodes_buffer_does() {
        assert_eq!(decode_base64("aGk="), b"hi");
        assert_eq!(decode_base64("a G\nk"), b"hi");
        assert_eq!(decode_base64("_-8"), [0xFF, 0xEF]);
        assert_eq!(decode_base64(""), b"");
    }
}
