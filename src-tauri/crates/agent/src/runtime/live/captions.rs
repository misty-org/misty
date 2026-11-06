//! Soniox's tokens as segments that revise (`SonioxCaptions` in `live/soniox.ts`).
use super::super::text::{js_is_space, js_len, js_trim};
use super::segment::{LiveChannel, Segment, Word};
use super::soniox::{SonioxResult, SonioxToken};

pub(crate) struct CaptionOptions {
    pub(crate) channel: Option<LiveChannel>,
    /// Skip translation output, for transcribe-only sessions.
    pub(crate) no_translation: bool,
}

/// Turns Soniox token streams into revised segments. Final tokens are append-only; provisional tokens
/// are a replacement snapshot. A final token from a new speaker closes the current segment, so each
/// segment has one speaker. Source and translation arrive independently, so a segment never finalizes
/// on source punctuation alone.
pub(crate) struct SonioxCaptions {
    session_id: String,
    source: String,
    target: String,
    emit: Box<dyn FnMut(Segment) + Send>,
    options: CaptionOptions,
    sequence: u64,
    segment: Option<Segment>,
    source_final: String,
    translation_final: String,
    source_draft: String,
    translation_draft: String,
    words: Vec<Word>,
}

impl SonioxCaptions {
    pub(crate) fn new(session_id: String, source: &str, target: &str, emit: Box<dyn FnMut(Segment) + Send>, options: CaptionOptions) -> Self {
        Self {
            session_id,
            source: source.to_owned(),
            target: target.to_owned(),
            emit,
            options,
            sequence: 0,
            segment: None,
            source_final: String::new(),
            translation_final: String::new(),
            source_draft: String::new(),
            translation_draft: String::new(),
            words: Vec::new(),
        }
    }

    pub(crate) fn ingest(&mut self, result: &SonioxResult, time: f64) {
        self.source_draft.clear();
        self.translation_draft.clear();
        for token in &result.tokens {
            if token.text.is_empty() || token.text == "<end>" || token.text == "<fin>" {
                continue;
            }
            let translation = token.translation_status.as_deref() == Some("translation");
            if translation && self.options.no_translation {
                continue;
            }
            let speaker = token.speaker.as_deref().filter(|speaker| !speaker.is_empty());
            let segment_speaker = self.segment.as_ref().and_then(|segment| segment.speaker.as_deref());
            if !translation
                && token.is_final
                && !self.source_final.is_empty()
                && matches!((speaker, segment_speaker), (Some(new), Some(old)) if !old.is_empty() && new != old)
            {
                // Carry the provisional tail of this result into the next speaker's segment.
                self.source_draft.clear();
                self.flush();
            }
            self.open(token, time, speaker);
            let Some(segment) = self.segment.as_mut() else {
                continue;
            };
            segment.end_ms = segment.end_ms.max(token.end_ms.unwrap_or(time));
            if translation {
                if token.is_final {
                    self.translation_final.push_str(&token.text);
                } else {
                    self.translation_draft.push_str(&token.text);
                }
                continue;
            }
            if let (Some(speaker), None) = (speaker, segment.speaker.as_deref()) {
                segment.speaker = Some(speaker.to_owned());
            }
            if token.is_final {
                self.source_final.push_str(&token.text);
                self.add_word(token, speaker);
            } else {
                self.source_draft.push_str(&token.text);
            }
        }
        self.publish(false);
        // Bound active caption/history records even during uninterrupted speech.
        if js_len(&self.source_final) + js_len(&self.translation_final) >= 1000 {
            self.flush();
        }
    }

    fn open(&mut self, token: &SonioxToken, time: f64, speaker: Option<&str>) {
        if self.segment.is_some() {
            return;
        }
        let sequence = self.sequence;
        self.sequence += 1;
        self.segment = Some(Segment {
            id: format!("{}:soniox-{sequence}", self.session_id),
            session_id: self.session_id.clone(),
            sequence,
            revision: 0,
            start_ms: token.start_ms.unwrap_or(time),
            end_ms: token.end_ms.unwrap_or(time),
            source_language: self.source.clone(),
            target_language: self.target.clone(),
            source_text: String::new(),
            translated_text: String::new(),
            is_final: false,
            state: "provisional",
            speaker: speaker.map(str::to_owned),
            channel: self.options.channel,
            words: None,
        });
    }

    fn add_word(&mut self, token: &SonioxToken, speaker: Option<&str>) {
        let Some(segment) = self.segment.as_ref() else {
            return;
        };
        let t0 = token.start_ms.unwrap_or(segment.end_ms);
        let t1 = token.end_ms.unwrap_or(t0);
        let speaker = speaker.or(segment.speaker.as_deref()).map(str::to_owned);
        // Soniox tokens are sub-word pieces; a leading space starts a new word.
        let starts_word = token.text.chars().next().is_some_and(js_is_space);
        if let (Some(last), false) = (self.words.last_mut(), starts_word) {
            last.text.push_str(&token.text);
            last.t1 = last.t1.max(t1);
            return;
        }
        let text = js_trim(&token.text);
        if !text.is_empty() {
            self.words.push(Word { text: text.to_owned(), t0, t1, speaker });
        }
    }

    fn publish(&mut self, is_final: bool) {
        let Some(segment) = self.segment.as_mut() else {
            return;
        };
        segment.source_text = format!("{}{}", self.source_final, if is_final { "" } else { &self.source_draft });
        segment.translated_text = format!("{}{}", self.translation_final, if is_final { "" } else { &self.translation_draft });
        segment.is_final = is_final;
        segment.state = if is_final { "complete" } else { "provisional" };
        if is_final && !self.words.is_empty() {
            segment.words = Some(self.words.clone());
        }
        segment.revision += 1;
        (self.emit)(segment.clone());
    }

    pub(crate) fn flush(&mut self) {
        // Replace any visible draft with provider-confirmed text; never save a guess as final.
        if !self.source_final.is_empty() || !self.translation_final.is_empty() {
            self.publish(true);
        } else {
            self.source_draft.clear();
            self.translation_draft.clear();
            self.publish(false);
        }
        self.segment = None;
        self.source_final.clear();
        self.translation_final.clear();
        self.source_draft.clear();
        self.translation_draft.clear();
        self.words.clear();
    }
}
