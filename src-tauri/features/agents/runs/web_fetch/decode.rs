//! A response body's bytes, decoded and capped. The cap holds on the decoded size, so a small
//! compressed body can't fill memory.
use std::io::{self, Write};

use brotli_decompressor::DecompressorWriter;
use flate2::{write::GzDecoder, Decompress, FlushDecompress, Status};

/// Keeps up to its limit, and fails the writer once full so a decoder stops working.
struct Capped {
    kept: Vec<u8>,
    limit: usize,
    /// As in the TypeScript, a body that exactly fills the limit counts as cut short.
    full: bool,
}

impl Capped {
    fn new(limit: usize) -> Self {
        Self { kept: Vec::new(), limit, full: false }
    }

    fn take(&mut self) -> Self {
        Self { kept: std::mem::take(&mut self.kept), limit: self.limit, full: self.full }
    }

    fn done(self) -> (Vec<u8>, bool) {
        (self.kept, self.full)
    }
}

impl Write for Capped {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.full {
            return Err(io::Error::other("the body reached its limit"));
        }
        let taken = (self.limit - self.kept.len()).min(bytes.len());
        self.kept.extend_from_slice(&bytes[..taken]);
        self.full = self.kept.len() >= self.limit;
        Ok(taken)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

enum Stage {
    /// Not compressed, or a finished gzip stream followed by padding.
    Plain { sink: Capped, ignore_rest: bool },
    /// `createUnzip` decides between gzip and zlib from the first two bytes.
    Undecided { limit: usize, start: Vec<u8> },
    Gzip(GzDecoder<Capped>),
    Zlib { inflate: Decompress, sink: Capped, ended: bool },
    Brotli(Box<DecompressorWriter<Capped>>),
}

pub(crate) struct BodyDecoder(Stage);

const GZIP_MAGIC: [u8; 2] = [0x1F, 0x8B];

impl BodyDecoder {
    /// A decoder for the response's `content-encoding`, already lowercased.
    pub(crate) fn new(encoding: &str, limit: usize) -> Self {
        Self(match encoding {
            "br" => Stage::Brotli(Box::new(DecompressorWriter::new(Capped::new(limit), 4096))),
            "gzip" | "deflate" => Stage::Undecided { limit, start: Vec::new() },
            _ => Stage::Plain { sink: Capped::new(limit), ignore_rest: false },
        })
    }

    /// Whether the limit was reached, so the rest needn't be read.
    pub(crate) fn full(&self) -> bool {
        match &self.0 {
            Stage::Plain { sink, .. } | Stage::Zlib { sink, .. } => sink.full,
            Stage::Undecided { .. } => false,
            Stage::Gzip(decoder) => decoder.get_ref().full,
            Stage::Brotli(decoder) => decoder.get_ref().full,
        }
    }

    /// Takes more of the body. Reaching the limit is not a failure.
    pub(crate) fn write(&mut self, mut bytes: &[u8]) -> io::Result<()> {
        if let Stage::Undecided { limit, start } = &mut self.0 {
            start.extend_from_slice(bytes);
            if start.len() < 2 {
                return Ok(());
            }
            let limit = *limit;
            let held = std::mem::take(start);
            self.0 = if held.starts_with(&GZIP_MAGIC) {
                Stage::Gzip(GzDecoder::new(Capped::new(limit)))
            } else {
                Stage::Zlib { inflate: Decompress::new(true), sink: Capped::new(limit), ended: false }
            };
            return self.write(&held);
        }
        while !bytes.is_empty() && !self.full() {
            let result = match &mut self.0 {
                Stage::Plain { ignore_rest: true, .. } | Stage::Undecided { .. } => return Ok(()),
                Stage::Plain { sink, .. } => sink.write(bytes),
                Stage::Zlib { inflate, sink, ended } => inflate_some(inflate, sink, ended, bytes),
                Stage::Brotli(decoder) => decoder.write(bytes),
                Stage::Gzip(decoder) => decoder.write(bytes),
            };
            match result {
                Ok(0) if matches!(self.0, Stage::Gzip(_)) => self.next_gzip_member(bytes)?,
                // A finished zlib stream takes nothing more, and Node ignores the rest.
                Ok(0) => return Ok(()),
                Ok(used) => bytes = &bytes[used..],
                Err(_) if self.full() => return Ok(()),
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    /// A gzip member ended with more to come. As in Node's zlib, a zero byte is padding and the rest
    /// is ignored, and anything else has to be another member.
    fn next_gzip_member(&mut self, rest: &[u8]) -> io::Result<()> {
        let Stage::Gzip(decoder) = &mut self.0 else {
            return Ok(());
        };
        decoder.try_finish()?;
        let sink = decoder.get_mut().take();
        self.0 = if rest.first() == Some(&0) {
            Stage::Plain { sink, ignore_rest: true }
        } else {
            Stage::Gzip(GzDecoder::new(sink))
        };
        Ok(())
    }

    /// The body so far, and whether there was more. Fails on a compressed stream that ended early,
    /// unless the limit was reached first.
    pub(crate) fn finish(self) -> io::Result<(Vec<u8>, bool)> {
        match self.0 {
            Stage::Plain { sink, .. } => Ok(sink.done()),
            // Nothing at all is an empty body, and one byte can't be a stream.
            Stage::Undecided { start, .. } if start.is_empty() => Ok((Vec::new(), false)),
            Stage::Undecided { .. } => Err(io::Error::from(io::ErrorKind::UnexpectedEof)),
            Stage::Gzip(mut decoder) => {
                if let Err(error) = decoder.try_finish() {
                    if !decoder.get_ref().full {
                        return Err(error);
                    }
                }
                Ok(decoder.get_mut().take().done())
            }
            Stage::Zlib { sink, ended, .. } => {
                if ended || sink.full {
                    Ok(sink.done())
                } else {
                    Err(io::Error::from(io::ErrorKind::UnexpectedEof))
                }
            }
            Stage::Brotli(mut decoder) => {
                if let Err(error) = decoder.close() {
                    if !decoder.get_ref().full {
                        return Err(error);
                    }
                }
                Ok(decoder.get_mut().take().done())
            }
        }
    }
}

/// Inflates what it can of `bytes` into the sink, and says how much it used.
fn inflate_some(inflate: &mut Decompress, sink: &mut Capped, ended: &mut bool, bytes: &[u8]) -> io::Result<usize> {
    if *ended {
        return Ok(0);
    }
    let mut out = [0u8; 16 * 1024];
    let (read, wrote) = (inflate.total_in(), inflate.total_out());
    let status = inflate.decompress(bytes, &mut out, FlushDecompress::None).map_err(io::Error::other)?;
    let produced = (inflate.total_out() - wrote) as usize;
    sink.write_all(&out[..produced])?;
    *ended = status == Status::StreamEnd;
    let used = (inflate.total_in() - read) as usize;
    if used == 0 && produced == 0 && !*ended {
        return Err(io::Error::from(io::ErrorKind::InvalidData));
    }
    // Output with no input used still has more to give, which counts as progress on the same bytes.
    if used == 0 && !*ended {
        return inflate_some(inflate, sink, ended, bytes);
    }
    Ok(used)
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use flate2::{
        write::{GzEncoder, ZlibEncoder},
        Compression,
    };

    use super::*;

    fn gzip(text: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(text).unwrap();
        encoder.finish().unwrap()
    }

    fn zlib(text: &[u8]) -> Vec<u8> {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(text).unwrap();
        encoder.finish().unwrap()
    }

    fn decode(encoding: &str, body: &[u8], limit: usize) -> io::Result<(Vec<u8>, bool)> {
        let mut decoder = BodyDecoder::new(encoding, limit);
        // One byte at a time finds any slip at a chunk's edge.
        for byte in body.chunks(1) {
            if decoder.full() {
                break;
            }
            decoder.write(byte)?;
        }
        decoder.finish()
    }

    #[test]
    fn plain_bodies_are_cut_at_the_limit_and_filling_it_counts_as_cut() {
        assert_eq!(decode("", b"hello", 10).unwrap(), (b"hello".to_vec(), false));
        assert_eq!(decode("", b"hello", 5).unwrap(), (b"hello".to_vec(), true));
        assert_eq!(decode("identity", b"hello", 3).unwrap(), (b"hel".to_vec(), true));
    }

    #[test]
    fn gzip_and_zlib_are_told_apart_from_their_first_bytes_whatever_the_header_says() {
        for encoding in ["gzip", "deflate"] {
            assert_eq!(decode(encoding, &gzip(b"unpacked"), 100).unwrap(), (b"unpacked".to_vec(), false));
            assert_eq!(decode(encoding, &zlib(b"unpacked"), 100).unwrap(), (b"unpacked".to_vec(), false));
        }
        assert_eq!(decode("gzip", b"", 100).unwrap(), (Vec::new(), false));
    }

    #[test]
    fn the_limit_holds_on_the_decoded_size() {
        let big = vec![b'a'; 1 << 20];
        for body in [gzip(&big), zlib(&big)] {
            let (kept, truncated) = decode("gzip", &body, 1000).unwrap();
            assert_eq!((kept.len(), truncated), (1000, true));
        }
    }

    #[test]
    fn a_stream_cut_short_or_corrupt_fails() {
        let whole = gzip(b"unpacked and then some more text");
        assert!(decode("gzip", &whole[..whole.len() - 4], 100).is_err());
        let whole = zlib(b"unpacked and then some more text");
        assert!(decode("gzip", &whole[..whole.len() - 6], 100).is_err());
        assert!(decode("deflate", b"this is not compressed", 100).is_err());
        assert!(decode("gzip", b"x", 100).is_err());
    }

    #[test]
    fn gzip_members_join_padding_is_ignored_and_other_trailing_bytes_fail() {
        let mut two = gzip(b"one ");
        two.extend(gzip(b"two"));
        assert_eq!(decode("gzip", &two, 100).unwrap().0, b"one two");
        let mut padded = gzip(b"one");
        padded.extend_from_slice(b"\0\0garbage");
        assert_eq!(decode("gzip", &padded, 100).unwrap().0, b"one");
        let mut garbage = gzip(b"one");
        garbage.extend_from_slice(b"garbage");
        assert!(decode("gzip", &garbage, 100).is_err());
    }

    #[test]
    fn brotli_decodes_and_a_stream_cut_short_fails() {
        // The crate only decompresses, so this is `brotliCompressSync("unpacked")` recorded from Node.
        let recorded: &[u8] = &[0x8B, 0x03, 0x80, 0x75, 0x6E, 0x70, 0x61, 0x63, 0x6B, 0x65, 0x64, 0x03];
        assert_eq!(decode("br", recorded, 100).unwrap(), (b"unpacked".to_vec(), false));
        assert_eq!(decode("br", recorded, 4).unwrap(), (b"unpa".to_vec(), true));
        assert!(decode("br", &recorded[..6], 100).is_err());
    }
}
