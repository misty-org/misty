//! Speaking aloud in a system voice: stopping what is said, reading an answer aloud sentence by
//! sentence as it arrives, and the voices and `say`-style command of each system.
use super::*;

/// Stops whatever is being said.
#[tauri::command]
pub async fn speech_stop(webview: Webview, state: State<'_, SpeechState>) -> Result<(), String> {
    require_person(&webview)?;
    stop_speaking(&state);
    Ok(())
}

pub(super) fn stop_speaking(state: &SpeechState) {
    if let Some(mut child) = state.speaking.lock().unwrap().take() {
        let _ = child.start_kill();
    }
    if let Some(reading) = state.reading.lock().unwrap().take() {
        reading.stop.notify_one();
    }
}

/// A reply read aloud while it's still being written: each sentence is handed over as it's
/// finished and read straight after the one before, so speaking starts with the first sentence
/// instead of the whole reply. The voice is set up as the reading opens, before any sentence.
pub(super) struct Reading {
    id: u64,
    /// Closed once the last sentence is in.
    sentences: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    stop: Arc<tokio::sync::Notify>,
    done: tokio::sync::watch::Receiver<bool>,
    /// How many sentences the voice has begun, for drawing in step with it.
    started: Arc<AtomicU32>,
}

/// Opens a reading in a system voice at `rate` (1 is the voice's usual pace), stopping anything
/// already being said. Sentences follow through `speech_reading_add`.
#[tauri::command]
pub async fn speech_reading_start(
    webview: Webview,
    state: State<'_, SpeechState>,
    voice: Option<String>,
    rate: Option<f64>,
) -> Result<u64, String> {
    require_person(&webview)?;
    stop_speaking(&state);
    let id = state.session.fetch_add(1, Ordering::SeqCst) + 1;
    let (sentences, heard) = tokio::sync::mpsc::unbounded_channel();
    let stop = Arc::new(tokio::sync::Notify::new());
    let (finished, done) = tokio::sync::watch::channel(false);
    let rate = rate.unwrap_or(1.0).clamp(0.5, 2.0);
    let started = Arc::new(AtomicU32::new(0));
    let (stopped, begun) = (stop.clone(), started.clone());
    tokio::spawn(async move {
        tokio::select! {
            _ = stopped.notified() => {}
            _ = read_aloud(heard, voice, rate, begun) => {}
        }
        let _ = finished.send(true);
    });
    *state.reading.lock().unwrap() = Some(Reading {
        id,
        sentences: Some(sentences),
        stop,
        done,
        started,
    });
    Ok(id)
}

/// How many of a reading's sentences the voice has begun. A reading that has ended, or was
/// stopped, has begun them all, which reads as a very large number.
#[tauri::command]
pub async fn speech_reading_progress(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
) -> Result<u32, String> {
    require_person(&webview)?;
    let slot = state.reading.lock().unwrap();
    Ok(match slot.as_ref() {
        Some(open) if open.id == reading && !*open.done.borrow() => {
            open.started.load(Ordering::SeqCst)
        }
        _ => u32::MAX,
    })
}

/// Hands a reading its next sentence.
#[tauri::command]
pub async fn speech_reading_add(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
    text: String,
) -> Result<(), String> {
    require_person(&webview)?;
    let text: String = text
        .chars()
        .take(4_000)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    if text.trim().is_empty() {
        return Ok(());
    }
    if let Some(open) = state.reading.lock().unwrap().as_ref() {
        if open.id == reading {
            if let Some(sentences) = &open.sentences {
                let _ = sentences.send(text.trim().to_string());
            }
        }
    }
    Ok(())
}

/// Says the reading has all its sentences. Answers once they've been read, or it was stopped.
#[tauri::command]
pub async fn speech_reading_end(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
) -> Result<(), String> {
    require_person(&webview)?;
    let done = {
        let mut slot = state.reading.lock().unwrap();
        match slot.as_mut() {
            Some(open) if open.id == reading => {
                open.sentences = None;
                open.done.clone()
            }
            _ => return Ok(()),
        }
    };
    let mut done = done;
    while !*done.borrow_and_update() {
        if done.changed().await.is_err() {
            break;
        }
    }
    let mut slot = state.reading.lock().unwrap();
    if slot.as_ref().is_some_and(|open| open.id == reading) {
        slot.take();
    }
    Ok(())
}

/// Reads each sentence as it arrives, until the last one has been read. Dropping it stops the voice.
#[cfg(target_os = "macos")]
async fn read_aloud(
    mut sentences: tokio::sync::mpsc::UnboundedReceiver<String>,
    voice: Option<String>,
    rate: f64,
    started: Arc<AtomicU32>,
) {
    // AVSpeechSynthesizer queues sentences with no gap; `say` is the fallback.
    let Ok(speaker) = voice_speech::Speaker::new(voice.as_deref(), rate) else {
        return read_one_by_one(sentences, voice, rate, started).await;
    };
    let mut open = true;
    loop {
        tokio::select! {
            next = sentences.recv(), if open => match next {
                Some(sentence) => speaker.say(&sentence),
                None => open = false,
            },
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
        started.store(speaker.started(), Ordering::SeqCst);
        if !open && !speaker.busy() {
            break;
        }
    }
}

/// One PowerShell voice for the whole reading, started as it opens (starting it is the slow
/// part), reading each line it's handed.
#[cfg(windows)]
async fn read_aloud(
    mut sentences: tokio::sync::mpsc::UnboundedReceiver<String>,
    voice: Option<String>,
    rate: f64,
    started: Arc<AtomicU32>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    const SCRIPT: &str = "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; \
        Add-Type -AssemblyName System.Speech; \
        $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
        if ($env:MISTY_VOICE) { try { $s.SelectVoice($env:MISTY_VOICE) } catch {} }; \
        $s.Rate = [int]$env:MISTY_RATE; \
        while ($null -ne ($line = [Console]::In.ReadLine())) { if ($line.Trim()) { [Console]::Out.WriteLine('s'); [Console]::Out.Flush(); $s.Speak($line) } }; \
        $s.Dispose()";
    let steps = ((rate - 1.0) * 10.0).round().clamp(-10.0, 10.0) as i32;
    let mut command = tokio::process::Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("MISTY_VOICE", voice.unwrap_or_default())
        .env("MISTY_RATE", steps.to_string())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true);
    crate::engine_config::support::hide_console_tokio(&mut command);
    let Ok(mut child) = command.spawn() else {
        return;
    };
    let Some(mut input) = child.stdin.take() else {
        return;
    };
    // The voice says "s" on a line of its own as it begins each sentence.
    if let Some(output) = child.stdout.take() {
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(output).lines();
            while let Ok(Some(_)) = lines.next_line().await {
                started.fetch_add(1, Ordering::SeqCst);
            }
        });
    }
    while let Some(sentence) = sentences.recv().await {
        let line = format!("{sentence}\n");
        if input.write_all(line.as_bytes()).await.is_err() || input.flush().await.is_err() {
            break;
        }
    }
    drop(input);
    let _ = child.wait().await;
}

#[cfg(not(any(target_os = "macos", windows)))]
async fn read_aloud(
    sentences: tokio::sync::mpsc::UnboundedReceiver<String>,
    voice: Option<String>,
    rate: f64,
    started: Arc<AtomicU32>,
) {
    read_one_by_one(sentences, voice, rate, started).await
}

/// Each sentence in a voice process of its own, one after another.
#[cfg_attr(windows, allow(dead_code))]
async fn read_one_by_one(
    mut sentences: tokio::sync::mpsc::UnboundedReceiver<String>,
    voice: Option<String>,
    rate: f64,
    started: Arc<AtomicU32>,
) {
    while let Some(sentence) = sentences.recv().await {
        started.fetch_add(1, Ordering::SeqCst);
        let Ok(mut command) = say_command(&sentence, voice.as_deref(), rate) else {
            return;
        };
        command.kill_on_drop(true);
        let Ok(mut child) = command.spawn() else {
            return;
        };
        let _ = child.wait().await;
    }
}

#[cfg(target_os = "macos")]
pub(super) fn say_command(
    text: &str,
    voice: Option<&str>,
    rate: f64,
) -> Result<tokio::process::Command, String> {
    let mut command = tokio::process::Command::new("say");
    if let Some(voice) = voice.filter(|voice| !voice.trim().is_empty()) {
        command.args(["-v", voice.trim()]);
    }
    // `say` speaks about 175 words a minute by default.
    let words = (175.0 * rate.clamp(0.5, 2.0)).round() as u32;
    command.args(["-r", &words.to_string(), "--"]).arg(text);
    Ok(command)
}

#[cfg(target_os = "linux")]
pub(super) fn say_command(
    text: &str,
    voice: Option<&str>,
    rate: f64,
) -> Result<tokio::process::Command, String> {
    let program = ["espeak-ng", "espeak"]
        .into_iter()
        .find(|name| on_path(name))
        .ok_or_else(|| "This computer has no voice to read it. Install espeak-ng.".to_string())?;
    let mut command = tokio::process::Command::new(program);
    let words = (165.0 * rate.clamp(0.5, 2.0)).round() as u32;
    command
        .args([
            "-v",
            voice
                .filter(|voice| !voice.trim().is_empty())
                .unwrap_or("en-us"),
        ])
        .args(["-s", &words.to_string(), "--"])
        .arg(text);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn on_path(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(name).is_file()))
        .unwrap_or(false)
}

#[cfg(windows)]
pub(super) fn say_command(
    text: &str,
    voice: Option<&str>,
    rate: f64,
) -> Result<tokio::process::Command, String> {
    // The text and voice go in through the environment, so nothing needs quoting.
    const SCRIPT: &str = "Add-Type -AssemblyName System.Speech; \
        $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
        if ($env:MISTY_VOICE) { try { $s.SelectVoice($env:MISTY_VOICE) } catch {} }; \
        $s.Rate = [int]$env:MISTY_RATE; \
        $s.Speak($env:MISTY_TEXT); \
        $s.Dispose()";
    // System.Speech rates run from -10 to 10, 0 being the voice's usual pace.
    let steps = ((rate.clamp(0.5, 2.0) - 1.0) * 10.0)
        .round()
        .clamp(-10.0, 10.0) as i32;
    let mut command = tokio::process::Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("MISTY_TEXT", text)
        .env("MISTY_VOICE", voice.unwrap_or(""))
        .env("MISTY_RATE", steps.to_string());
    crate::engine_config::support::hide_console_tokio(&mut command);
    Ok(command)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub(super) fn say_command(
    _text: &str,
    _voice: Option<&str>,
    _rate: f64,
) -> Result<tokio::process::Command, String> {
    Err("This computer has no voice to read it.".into())
}

/// The system's voices, for the voice picker.
pub(super) async fn system_voices() -> Vec<SystemVoice> {
    #[cfg(target_os = "macos")]
    {
        let listed = tokio::process::Command::new("say")
            .args(["-v", "?"])
            .output()
            .await
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .unwrap_or_default();
        listed.lines().filter_map(parse_say_voice).collect()
    }
    #[cfg(windows)]
    {
        const SCRIPT: &str = "Add-Type -AssemblyName System.Speech; \
            $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
            $s.GetInstalledVoices() | Where-Object { $_.Enabled } | \
            ForEach-Object { $_.VoiceInfo.Name + \"`t\" + $_.VoiceInfo.Culture.Name }";
        let mut command = tokio::process::Command::new("powershell");
        command.args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT]);
        crate::engine_config::support::hide_console_tokio(&mut command);
        let listed = command
            .output()
            .await
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .unwrap_or_default();
        listed
            .lines()
            .filter_map(|line| {
                let (name, language) = line.trim().split_once('\t')?;
                Some(SystemVoice {
                    id: name.to_string(),
                    name: name.to_string(),
                    language: language.to_string(),
                })
            })
            .collect()
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Vec::new()
    }
}

/// One line of `say -v ?`: "Samantha            en_US    # Hello, my name is Samantha."
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_say_voice(line: &str) -> Option<SystemVoice> {
    let head = line.split('#').next()?.trim_end();
    let language_at = head.rfind(char::is_whitespace)?;
    let language = head[language_at..].trim();
    let name = head[..language_at].trim();
    if name.is_empty() || !language.contains('_') {
        return None;
    }
    Some(SystemVoice {
        id: name.to_string(),
        name: name.to_string(),
        language: language.replace('_', "-"),
    })
}

#[cfg(test)]
mod tests {
    use super::parse_say_voice;

    #[test]
    fn reads_a_say_voice_line() {
        let voice = parse_say_voice("Samantha            en_US    # Hello, my name is Samantha.")
            .expect("a voice");
        assert_eq!(voice.name, "Samantha");
        assert_eq!(voice.language, "en-US");
        let named = parse_say_voice("Eddy (English (US))  en_US    # Hello! My name is Eddy.")
            .expect("a voice with a long name");
        assert_eq!(named.name, "Eddy (English (US))");
        assert!(parse_say_voice("").is_none());
    }
}
