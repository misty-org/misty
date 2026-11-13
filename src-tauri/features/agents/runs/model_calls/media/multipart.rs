//! A multipart form, written by hand because nothing else in Misty needs reqwest's `multipart`
//! feature and the forms here are only a few fields.
use crate::model_calls::ids::generate_id;

pub(super) struct Form {
    boundary: String,
    body: Vec<u8>,
}

impl Form {
    pub(super) fn new() -> Self {
        Self { boundary: format!("----misty-form-{}", generate_id()), body: Vec::new() }
    }

    fn opening(&mut self) {
        self.body.extend_from_slice(b"--");
        self.body.extend_from_slice(self.boundary.as_bytes());
        self.body.extend_from_slice(b"\r\n");
    }

    pub(super) fn text(&mut self, name: &str, value: &str) {
        self.opening();
        self.body.extend_from_slice(format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes());
        self.body.extend_from_slice(value.as_bytes());
        self.body.extend_from_slice(b"\r\n");
    }

    pub(super) fn file(&mut self, name: &str, filename: &str, content_type: &str, bytes: &[u8]) {
        self.opening();
        self.body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n").as_bytes(),
        );
        self.body.extend_from_slice(bytes);
        self.body.extend_from_slice(b"\r\n");
    }

    pub(super) fn content_type(&self) -> String {
        format!("multipart/form-data; boundary={}", self.boundary)
    }

    pub(super) fn finish(mut self) -> Vec<u8> {
        self.body.extend_from_slice(b"--");
        self.body.extend_from_slice(self.boundary.as_bytes());
        self.body.extend_from_slice(b"--\r\n");
        self.body
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_are_framed_by_the_boundary() {
        let mut form = Form::new();
        form.text("model", "whisper-1");
        form.file("file", "audio.wav", "audio/wav", &[0, 255]);
        let boundary = form.boundary.clone();
        assert_eq!(form.content_type(), format!("multipart/form-data; boundary={boundary}"));
        let mut expected = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .into_bytes();
        expected.extend_from_slice(&[0, 255]);
        expected.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        assert_eq!(form.finish(), expected);
    }
}
