use std::io::{self, Read, Write};
use std::path::PathBuf;

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{HearingEvent, HearingSpec, Phrase, VadSpec, VoiceSpec};

pub const MOST_FRAME_BYTES: usize = 1 << 30;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    OpenRecognizer {
        spec: HearingSpec,
        language: Option<String>,
    },
    Recognize {
        recognizer: u64,
        offset: f64,
    },
    RecognizeSamples {
        recognizer: u64,
        vad: VadSpec,
    },
    RecognizeFile {
        recognizer: u64,
        vad: VadSpec,
        path: PathBuf,
    },
    DecodeFile {
        path: PathBuf,
    },
    Resample {
        rate: i32,
    },
    OpenVoice {
        spec: VoiceSpec,
    },
    Speak {
        voice: u64,
        text: String,
        speaker: i32,
        speed: f32,
    },
    OpenHearing {
        recognizer: u64,
        vad: VadSpec,
    },
    Push {
        hearing: u64,
        input: String,
    },
    Flush {
        hearing: u64,
        input: String,
    },
    Reset {
        hearing: u64,
        input: String,
    },
    Remove {
        hearing: u64,
        input: String,
    },
    CloseHearing {
        hearing: u64,
    },
    Forget {
        handle: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Call {
    pub id: u64,
    pub request: Request,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Answer {
    Done,
    Opened { handle: u64 },
    Phrase { phrase: Phrase },
    Phrases { phrases: Vec<Phrase> },
    Samples,
    Speech { rate: u32 },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "message", rename_all = "snake_case")]
pub enum Message {
    Reply {
        id: u64,
        answer: Result<Answer, String>,
    },
    Event {
        hearing: u64,
        event: HearingEvent,
    },
}

pub fn encode(header: &impl Serialize, payload: &[u8]) -> io::Result<Vec<u8>> {
    let header = serde_json::to_vec(header).map_err(io::Error::other)?;
    if header.len() > MOST_FRAME_BYTES || payload.len() > MOST_FRAME_BYTES {
        return Err(io::Error::other(
            "the message is over the speech helper's limit",
        ));
    }
    let mut frame = Vec::with_capacity(8 + header.len() + payload.len());
    frame.extend_from_slice(&(header.len() as u32).to_le_bytes());
    frame.extend_from_slice(&header);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

pub fn write_frame(
    output: &mut impl Write,
    header: &impl Serialize,
    payload: &[u8],
) -> io::Result<()> {
    let frame = encode(header, payload)?;
    output.write_all(&frame)?;
    output.flush()
}

fn read_length(input: &mut impl Read) -> io::Result<Option<usize>> {
    let mut bytes = [0u8; 4];
    let mut filled = 0;
    while filled < bytes.len() {
        match input.read(&mut bytes[filled..]) {
            Ok(0) if filled == 0 => return Ok(None),
            Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    let length = u32::from_le_bytes(bytes) as usize;
    if length > MOST_FRAME_BYTES {
        return Err(io::Error::other(
            "the message is over the speech helper's limit",
        ));
    }
    Ok(Some(length))
}

fn read_bytes(input: &mut impl Read, length: usize) -> io::Result<Vec<u8>> {
    let mut bytes = vec![0u8; length];
    input.read_exact(&mut bytes)?;
    Ok(bytes)
}

pub fn read_frame<T: DeserializeOwned>(input: &mut impl Read) -> io::Result<Option<(T, Vec<u8>)>> {
    let Some(header_length) = read_length(input)? else {
        return Ok(None);
    };
    let header = read_bytes(input, header_length)?;
    let payload_length = read_length(input)?.ok_or(io::ErrorKind::UnexpectedEof)?;
    let payload = read_bytes(input, payload_length)?;
    let value = serde_json::from_slice(&header).map_err(io::Error::other)?;
    Ok(Some((value, payload)))
}

pub fn samples_to_bytes(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

pub fn bytes_to_samples(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|four| f32::from_le_bytes([four[0], four[1], four[2], four[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_call_and_its_samples_come_back_as_they_were_sent() {
        let call = Call {
            id: 7,
            request: Request::Push {
                hearing: 3,
                input: "mic".into(),
            },
        };
        let samples = [0.25f32, -1.0, 0.0, 0.5];
        let mut wire = Vec::new();
        write_frame(&mut wire, &call, &samples_to_bytes(&samples)).unwrap();
        write_frame(&mut wire, &call, &[]).unwrap();
        let mut reading = wire.as_slice();
        let (first, payload) = read_frame::<Call>(&mut reading).unwrap().unwrap();
        assert_eq!(first.id, 7);
        assert!(matches!(first.request, Request::Push { hearing: 3, ref input } if input == "mic"));
        assert_eq!(bytes_to_samples(&payload), samples);
        let (_, empty) = read_frame::<Call>(&mut reading).unwrap().unwrap();
        assert!(empty.is_empty());
        assert!(read_frame::<Call>(&mut reading).unwrap().is_none());
    }

    #[test]
    fn a_reply_carries_its_result_and_events_keep_their_input() {
        let replies = [
            Message::Reply {
                id: 1,
                answer: Ok(Answer::Opened { handle: 9 }),
            },
            Message::Reply {
                id: 2,
                answer: Err("no".into()),
            },
            Message::Event {
                hearing: 4,
                event: HearingEvent::Started {
                    input: "ana".into(),
                },
            },
            Message::Event {
                hearing: 4,
                event: HearingEvent::Heard {
                    input: "ana".into(),
                    phrase: Phrase {
                        text: "hello".into(),
                        start: 0.5,
                        end: 1.25,
                        words: Vec::new(),
                    },
                },
            },
            Message::Event {
                hearing: 4,
                event: HearingEvent::Closed,
            },
        ];
        let mut wire = Vec::new();
        for reply in &replies {
            write_frame(&mut wire, reply, &[]).unwrap();
        }
        let mut reading = wire.as_slice();
        for reply in &replies {
            let (read, _) = read_frame::<Message>(&mut reading).unwrap().unwrap();
            assert_eq!(&read, reply);
        }
    }

    #[test]
    fn a_cut_off_frame_is_an_error_not_an_end() {
        let mut wire = Vec::new();
        write_frame(&mut wire, &Answer::Done, &[1, 2, 3, 4]).unwrap();
        wire.truncate(wire.len() - 2);
        assert!(read_frame::<Answer>(&mut wire.as_slice()).is_err());
        assert!(read_frame::<Answer>(&mut [1u8, 0].as_slice()).is_err());
    }
}
