# misty-audio-capture

On-demand audio capture behind Misty's dictation, live transcription and translation,
and recording.

- `AudioSource::Mic`, `System { exclude_self }` and `Processes(pids)`.
- Output is 16 kHz mono PCM16 in `PcmChunk`s tagged `Channel::Mic` or
  `Channel::System`. Channels are never mixed, so a transcriber can tell the
  local person from everyone else before it diarizes.
- `PreRoll` keeps the last moments of an open capture; `Resampler` converts
  device formats; `DuplexRouter` and `EchoReducer` subtract system audio from
  the microphone by reference (NLMS), with no third-party AEC.
- No app framework, billing or account code. Callers own permissions UX,
  events and transport.

| Platform | Microphone | System audio | Per-process |
|---|---|---|---|
| macOS 13+ | AVAudioEngine | Core Audio process tap, 14.2+ | Core Audio process tap, 14.2+ |
| Windows 10 2004+ | WASAPI | Process loopback (excluding this tree) or device loopback | Process loopback, including each tree |

On macOS the Swift package in `apple/` is built and linked by `build.rs` (via
`swift-rs`). Set `MISTY_AUDIO_SKIP_SWIFT=1` to type-check from another host.

```rust
let capture = misty_audio_capture::start(
    misty_audio_capture::AudioSource::Mic,
    |chunk| send(chunk.to_le_bytes()),
    |error| eprintln!("{error}"),
)?;
// … later
capture.stop();
```
