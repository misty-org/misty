//! Speech on Windows: Windows' own offline recognizer (System.Speech, the desktop speech engine),
//! run in a PowerShell process the way the system voice is (`voice/speech/aloud.rs`), so no other
//! language or runtime ships with Misty and nothing leaves the computer.
//!
//! The microphone is heard by the recognizer itself. Fed audio (a capture's channel, 16 kHz mono
//! PCM16) is piped into its standard input. A recorded file is decoded to that same audio with
//! Media Foundation and piped in the same way. The process answers one JSON line per thing it
//! hears: `ready`, `partial`, `final`, `error` and `end`.

use std::{
    io::{BufRead, BufReader, Write},
    os::windows::process::CommandExt,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;

use crate::{reason, Heard, Phrase, StreamHeard};

/// The rate of the audio Misty feeds in (a capture's channel: 16 kHz mono PCM16).
const FED_RATE: f64 = 16_000.0;
/// No console window for the PowerShell process.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// How long PowerShell and the recognizer may take to start: the first start of the day is slow.
const START_LIMIT: Duration = Duration::from_secs(20);

/// The recognizer, as one PowerShell script. Its settings come in through the environment, so
/// nothing needs quoting: `MISTY_SPEECH_INPUT` is `microphone` or `stream`, `MISTY_SPEECH_LOCALE`
/// a language tag (`en-US`) or empty for the system's, and `MISTY_SPEECH_CHECK` only asks whether
/// any recognizer is installed.
const SCRIPT: &str = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try { Add-Type -AssemblyName System.Speech } catch { Say @{ kind = 'error'; code = 'unsupported' }; exit }
$all = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
if ($env:MISTY_SPEECH_CHECK) { Say @{ kind = 'supported'; any = ($all.Count -gt 0) }; exit }
function Pick($tag) {
  $exact = $all | Where-Object { $_.Culture.Name -eq $tag } | Select-Object -First 1
  if ($exact) { return $exact }
  $language = $tag.Split('-')[0]
  return $all | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $language } | Select-Object -First 1
}
if ($env:MISTY_SPEECH_LOCALE) { $info = Pick $env:MISTY_SPEECH_LOCALE }
else {
  $info = Pick ([System.Globalization.CultureInfo]::CurrentUICulture.Name)
  if (-not $info) { $info = $all | Select-Object -First 1 }
}
if (-not $info) { Say @{ kind = 'error'; code = 'unavailable' }; exit }
try {
  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
} catch { Say @{ kind = 'error'; code = 'unavailable' }; exit }
$microphone = $env:MISTY_SPEECH_INPUT -eq 'microphone'
try {
  if ($microphone) { $r.SetInputToDefaultAudioDevice() }
  else {
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $r.SetInputToAudioStream([Console]::OpenStandardInput(), $format)
  }
} catch { Say @{ kind = 'error'; code = 'microphone' }; exit }
$null = Register-ObjectEvent -InputObject $r -EventName SpeechHypothesized -SourceIdentifier misty.partial
$null = Register-ObjectEvent -InputObject $r -EventName SpeechRecognized -SourceIdentifier misty.final
$null = Register-ObjectEvent -InputObject $r -EventName RecognizeCompleted -SourceIdentifier misty.done
try { $r.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple) } catch { Say @{ kind = 'error'; code = 'microphone' }; exit }
Say @{ kind = 'ready' }
# The microphone listens until Misty closes standard input; fed audio, until its stream ends. The
# raw stream's BeginRead waits on a thread of its own (the console reader's ReadLineAsync blocks).
if ($microphone) { $closed = [Console]::OpenStandardInput().BeginRead((New-Object byte[] 1), 0, 1, $null, $null) }
$stopping = $false
$ended = $false
while (-not $ended) {
  foreach ($item in @(Get-Event)) {
    Remove-Event -EventIdentifier $item.EventIdentifier
    $result = $item.SourceEventArgs.Result
    switch ($item.SourceIdentifier) {
      'misty.partial' { Say @{ kind = 'partial'; text = [string]$result.Text } }
      'misty.final' {
        $start = 0.0; $length = 0.0
        if ($result.Audio) { $start = $result.Audio.AudioPosition.TotalSeconds; $length = $result.Audio.Duration.TotalSeconds }
        Say @{ kind = 'final'; text = [string]$result.Text; start = $start; end = $start + $length; confidence = [double]$result.Confidence }
      }
      'misty.done' { $ended = $true }
    }
  }
  if ($microphone -and -not $stopping -and $closed.IsCompleted) { $stopping = $true; $r.RecognizeAsyncStop() }
  if (-not $ended) { Start-Sleep -Milliseconds 40 }
}
Say @{ kind = 'end' }
$r.Dispose()
"#;

/// One line from the recognizer.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Message {
    Supported {
        #[serde(default)]
        any: bool,
    },
    Ready,
    Partial {
        #[serde(default)]
        text: String,
    },
    Final {
        #[serde(default)]
        text: String,
        #[serde(default)]
        start: f64,
        #[serde(default)]
        end: f64,
        #[serde(default)]
        confidence: f32,
    },
    Error {
        #[serde(default)]
        code: String,
    },
    End,
}

fn recognizer_command(input: &str, locale: Option<&str>, check: bool) -> Command {
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .env("MISTY_SPEECH_INPUT", input)
        .env("MISTY_SPEECH_LOCALE", locale.unwrap_or(""))
        .env("MISTY_SPEECH_CHECK", if check { "1" } else { "" })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    command
}

/// Whether this computer has a recognizer installed for any language. Asked once: it starts
/// PowerShell, which is slow.
pub fn supported() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        let Ok(mut child) = recognizer_command("stream", None, true).spawn() else {
            return false;
        };
        drop(child.stdin.take());
        let any = child.stdout.take().is_some_and(|out| {
            BufReader::new(out)
                .lines()
                .map_while(Result::ok)
                .any(|line| matches!(serde_json::from_str(&line), Ok(Message::Supported { any: true })))
        });
        let _ = child.wait();
        any
    })
}

/// What the recognizer has heard so far, shared with the thread reading its answers.
#[derive(Default)]
struct State {
    ready: bool,
    finished: Vec<Phrase>,
    partial: String,
    ended: bool,
    error: Option<String>,
}

impl State {
    fn text(&self) -> String {
        let mut words: Vec<&str> = self.finished.iter().map(|phrase| phrase.text.as_str()).collect();
        if !self.partial.is_empty() {
            words.push(&self.partial);
        }
        words.join(" ")
    }
}

/// A running recognizer process: its answers read on a thread of their own into `state`.
struct Recognizer {
    child: Child,
    state: Arc<Mutex<State>>,
}

impl Recognizer {
    /// Starts the recognizer and waits until it listens, or says why it can't.
    fn start(input: &str, locale: Option<&str>) -> Result<(Self, ChildStdin), String> {
        let mut child = recognizer_command(input, locale, false)
            .spawn()
            .map_err(|_| reason("unsupported"))?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            return Err(reason("unsupported"));
        };
        let state = Arc::new(Mutex::new(State::default()));
        let shared = state.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(message) = serde_json::from_str::<Message>(line.trim()) else {
                    continue;
                };
                let mut state = shared.lock().unwrap();
                match message {
                    Message::Ready => state.ready = true,
                    Message::Partial { text } => state.partial = text.trim().to_owned(),
                    Message::Final { text, start, end, confidence } => {
                        state.partial.clear();
                        let text = text.trim();
                        if !text.is_empty() {
                            state.finished.push(Phrase { text: text.to_owned(), start, end, confidence });
                        }
                    }
                    Message::Error { code } => state.error = Some(code),
                    Message::End => state.ended = true,
                    Message::Supported { .. } => {}
                }
            }
            // The process is gone, whether it said so or not.
            shared.lock().unwrap().ended = true;
        });
        let recognizer = Self { child, state };
        let deadline = Instant::now() + START_LIMIT;
        loop {
            {
                let state = recognizer.state.lock().unwrap();
                if let Some(code) = &state.error {
                    let why = reason(code);
                    drop(state);
                    recognizer.end();
                    return Err(why);
                }
                if state.ready {
                    break;
                }
                if state.ended || Instant::now() >= deadline {
                    drop(state);
                    recognizer.end();
                    return Err(reason("unsupported"));
                }
            }
            thread::sleep(Duration::from_millis(25));
        }
        Ok((recognizer, stdin))
    }

    /// Waits until the recognizer says it's done, up to `limit`.
    fn wait_for_end(&self, limit: Duration) {
        let deadline = Instant::now() + limit;
        while Instant::now() < deadline && !self.state.lock().unwrap().ended {
            thread::sleep(Duration::from_millis(40));
        }
    }

    fn end(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The microphone, recognized as it's spoken, until stopped.
pub struct Listening {
    recognizer: Recognizer,
    /// Closing it tells the recognizer to stop listening.
    stdin: Option<ChildStdin>,
}

impl Listening {
    pub fn heard(&self) -> Heard {
        let state = self.recognizer.state.lock().unwrap();
        Heard {
            text: state.text(),
            done: state.ended,
            error: state.error.is_some().then(|| "failed".to_string()),
        }
    }

    /// Stops listening and waits a moment for the last words to settle.
    pub fn stop(mut self) -> Heard {
        drop(self.stdin.take());
        self.recognizer.wait_for_end(Duration::from_secs(3));
        let mut heard = self.heard();
        heard.done = true;
        self.recognizer.end();
        heard
    }
}

/// Starts recognizing the microphone in `locale`.
pub fn listen(locale: Option<&str>) -> Result<Listening, String> {
    let (recognizer, stdin) = Recognizer::start("microphone", locale)?;
    Ok(Listening { recognizer, stdin: Some(stdin) })
}

/// Audio Misty already has (a capture's channel: 16 kHz mono PCM16), recognized as it's fed.
pub struct Streaming {
    recognizer: Recognizer,
    /// Audio for the writer thread, which pipes it in; dropping it ends the stream.
    audio: Option<mpsc::Sender<Vec<u8>>>,
    writer: Option<thread::JoinHandle<()>>,
    /// Samples fed so far, for the time of the phrase still being heard.
    samples: Mutex<usize>,
}

impl Streaming {
    pub fn push(&self, pcm: &[i16]) {
        if pcm.is_empty() {
            return;
        }
        let bytes: Vec<u8> = pcm.iter().flat_map(|sample| sample.to_le_bytes()).collect();
        if let Some(audio) = &self.audio {
            if audio.send(bytes).is_ok() {
                *self.samples.lock().unwrap() += pcm.len();
            }
        }
    }

    pub fn heard(&self) -> StreamHeard {
        let samples = *self.samples.lock().unwrap();
        let state = self.recognizer.state.lock().unwrap();
        let start = state.finished.last().map_or(0.0, |phrase| phrase.end);
        StreamHeard {
            segments: state.finished.clone(),
            current: (!state.partial.is_empty()).then(|| Phrase {
                text: state.partial.clone(),
                start,
                end: (samples as f64 / FED_RATE).max(start),
                confidence: 0.0,
            }),
        }
    }

    /// Ends the audio and waits for the recognizer to finish what it has.
    pub fn stop(self) -> StreamHeard {
        self.finish(Duration::from_secs(5))
    }

    fn finish(mut self, limit: Duration) -> StreamHeard {
        drop(self.audio.take());
        if let Some(writer) = self.writer.take() {
            let _ = writer.join();
        }
        self.recognizer.wait_for_end(limit);
        let mut heard = self.heard();
        // What was still being heard when it ended counts as said.
        if let Some(current) = heard.current.take() {
            heard.segments.push(current);
        }
        self.recognizer.end();
        heard
    }
}

/// Starts recognizing fed audio in `locale`.
pub fn stream(locale: Option<&str>) -> Result<Streaming, String> {
    let (recognizer, mut stdin) = Recognizer::start("stream", locale)?;
    let (audio, chunks) = mpsc::channel::<Vec<u8>>();
    // Its own thread, so a recognizer reading slowly never holds up the caller.
    let writer = thread::spawn(move || {
        for chunk in chunks {
            if stdin.write_all(&chunk).is_err() {
                return;
            }
        }
        let _ = stdin.flush();
    });
    Ok(Streaming { recognizer, audio: Some(audio), writer: Some(writer), samples: Mutex::new(0) })
}

/// Recognizes a recorded file; blocks until done.
pub fn recognize_file(path: &str, locale: Option<&str>) -> Result<String, String> {
    let phrases = recognize_file_phrases(path, locale)?;
    Ok(phrases.iter().map(|phrase| phrase.text.as_str()).collect::<Vec<_>>().join(" "))
}

/// Recognizes a recorded file phrase by phrase, each with its time in seconds from the start;
/// blocks until done. For captions.
pub fn recognize_file_phrases(path: &str, locale: Option<&str>) -> Result<Vec<Phrase>, String> {
    let pcm = decode::to_fed_audio(path).map_err(|_| reason("failed"))?;
    let streaming = stream(locale)?;
    for chunk in pcm.chunks(16_000) {
        streaming.push(chunk);
    }
    // Recognizing takes a while past the audio's own length.
    let length = Duration::from_secs_f64(pcm.len() as f64 / FED_RATE);
    let heard = streaming.finish(length * 2 + Duration::from_secs(30));
    Ok(heard.segments)
}

/// No system voice here reads a queue of sentences; callers speak each one on its own instead
/// (`voice/speech/aloud.rs` runs its own PowerShell voice).
pub struct Speaker;

impl Speaker {
    pub fn new(_voice: Option<&str>, _pace: f64) -> Result<Self, String> {
        Err("unsupported".into())
    }

    pub fn say(&self, _text: &str) {}

    pub fn busy(&self) -> bool {
        false
    }

    pub fn started(&self) -> u32 {
        0
    }
}

/// Recorded audio of any kind Windows can play, as the audio Misty feeds the recognizer.
mod decode {
    use windows::{
        core::{Result, HSTRING},
        Win32::{
            Media::MediaFoundation::{
                IMFSample, MFAudioFormat_PCM, MFCreateMediaType, MFCreateSourceReaderFromURL,
                MFMediaType_Audio, MFShutdown, MFStartup, MFSTARTUP_NOSOCKET, MF_MT_AUDIO_BITS_PER_SAMPLE,
                MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_MAJOR_TYPE,
                MF_MT_SUBTYPE, MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READER_ALL_STREAMS,
                MF_SOURCE_READER_FIRST_AUDIO_STREAM, MF_VERSION,
            },
            System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED},
        },
    };

    /// The file decoded to 16 kHz mono PCM16.
    pub(super) fn to_fed_audio(path: &str) -> Result<Vec<i16>> {
        // SAFETY: COM and Media Foundation are started for this thread and shut down after; every
        // buffer is unlocked before it's let go.
        unsafe {
            let com = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET)?;
            let decoded = read_pcm(path);
            let _ = MFShutdown();
            if com.is_ok() {
                CoUninitialize();
            }
            let (samples, rate, channels) = decoded?;
            Ok(resample(&downmix(&samples, channels), rate, 16_000))
        }
    }

    /// The file's first audio stream as 16-bit PCM, at its own rate and channel count.
    unsafe fn read_pcm(path: &str) -> Result<(Vec<i16>, u32, u32)> {
        let reader = MFCreateSourceReaderFromURL(&HSTRING::from(path), None)?;
        let audio = MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32;
        reader.SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false)?;
        reader.SetStreamSelection(audio, true)?;
        let wanted = MFCreateMediaType()?;
        wanted.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        wanted.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)?;
        wanted.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        reader.SetCurrentMediaType(audio, None, &wanted)?;
        let actual = reader.GetCurrentMediaType(audio)?;
        let rate = actual.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND)?;
        let channels = actual.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS)?.max(1);
        let mut samples = Vec::new();
        loop {
            let mut flags = 0u32;
            let mut sample: Option<IMFSample> = None;
            reader.ReadSample(audio, 0, None, Some(&mut flags), None, Some(&mut sample))?;
            if let Some(sample) = sample {
                let buffer = sample.ConvertToContiguousBuffer()?;
                let mut data = std::ptr::null_mut();
                let mut length = 0u32;
                buffer.Lock(&mut data, None, Some(&mut length))?;
                let bytes = std::slice::from_raw_parts(data, length as usize);
                samples.extend(bytes.chunks_exact(2).map(|pair| i16::from_le_bytes([pair[0], pair[1]])));
                buffer.Unlock()?;
            }
            if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                break;
            }
        }
        Ok((samples, rate, channels))
    }

    /// Interleaved channels averaged into one.
    pub(super) fn downmix(samples: &[i16], channels: u32) -> Vec<i16> {
        let channels = channels.max(1) as usize;
        samples
            .chunks_exact(channels)
            .map(|frame| (frame.iter().map(|&s| i32::from(s)).sum::<i32>() / channels as i32) as i16)
            .collect()
    }

    /// Linear resampling, which is enough for speech.
    pub(super) fn resample(samples: &[i16], from: u32, to: u32) -> Vec<i16> {
        if from == to || from == 0 || samples.is_empty() {
            return samples.to_vec();
        }
        let step = f64::from(from) / f64::from(to);
        let count = (samples.len() as f64 / step) as usize;
        (0..count)
            .map(|index| {
                let at = index as f64 * step;
                let base = at as usize;
                let next = (base + 1).min(samples.len() - 1);
                let fraction = at - base as f64;
                (f64::from(samples[base]) * (1.0 - fraction) + f64::from(samples[next]) * fraction) as i16
            })
            .collect()
    }
}
