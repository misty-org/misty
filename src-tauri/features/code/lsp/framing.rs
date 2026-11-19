//! LSP's base protocol: each message is a `Content-Length` header, a blank line, and that many
//! bytes of JSON. The window sends and receives the JSON alone; the headers live only here.

use std::io;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt};

/// A message larger than this is a broken server, not a real answer.
pub(super) const MOST_BYTES: usize = 64 * 1024 * 1024;
/// A header line longer than this is not a header.
const MOST_HEADER_BYTES: u64 = 4096;

/// The header that goes before `body`.
pub(super) fn header(body: &str) -> String {
    format!("Content-Length: {}\r\n\r\n", body.len())
}

/// The next message's body, or nothing once the server has closed its output.
pub(super) async fn read_message<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> io::Result<Option<String>> {
    let mut length: Option<usize> = None;
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = (&mut *reader)
            .take(MOST_HEADER_BYTES)
            .read_until(b'\n', &mut line)
            .await?;
        if read == 0 {
            return Ok(None);
        }
        if !line.ends_with(b"\n") && read as u64 >= MOST_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "a header line was too long",
            ));
        }
        let text = String::from_utf8_lossy(&line);
        let text = text.trim_end_matches(['\r', '\n']);
        if text.is_empty() {
            // The blank line ends the headers; one before any header is noise to skip.
            match length {
                Some(length) => break read_body(reader, length).await.map(Some),
                None => continue,
            }
        }
        if let Some((name, value)) = text.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().ok();
            }
        }
    }
}

async fn read_body<R: AsyncBufRead + Unpin>(reader: &mut R, length: usize) -> io::Result<String> {
    if length > MOST_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "a message was too large",
        ));
    }
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).await?;
    Ok(String::from_utf8(body)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn messages_are_read_one_at_a_time() {
        let first = r#"{"jsonrpc":"2.0","id":1,"result":null}"#;
        let second = r#"{"jsonrpc":"2.0","method":"x","params":"é"}"#;
        let stream = format!(
            "{}{first}Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n{}{second}",
            header(first),
            header(second)
        );
        let mut reader = stream.as_bytes();
        assert_eq!(
            read_message(&mut reader).await.unwrap().as_deref(),
            Some(first)
        );
        assert_eq!(
            read_message(&mut reader).await.unwrap().as_deref(),
            Some(second)
        );
        assert_eq!(read_message(&mut reader).await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_cut_off_message_is_an_error() {
        let mut reader: &[u8] = b"Content-Length: 10\r\n\r\n{\"a\"";
        assert!(read_message(&mut reader).await.is_err());
    }

    #[test]
    fn the_length_counts_bytes_not_characters() {
        assert_eq!(header("é"), "Content-Length: 2\r\n\r\n");
    }
}
