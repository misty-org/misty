# Companion native audio integration

Updated October 3, 2026. Voice uses a persistent `openai/gpt-realtime-2.1`
conversation through the existing authenticated AI Gateway WebSocket. Ctrl+Option
remains push-to-talk. Ordinary voice conversation responds directly; it no longer waits
for transcription, a high-reasoning task, and segmented text-to-speech in series.
Typed messages, including attachment and screen requests, use the existing durable
text invocation runtime. They do not open a realtime session or automatically
narrate the reply, so voice provider availability cannot block text admission or
completion. Screen requests still capture fresh displays when needed; ordinary
text chat takes no screenshots and does not require the native overlay to start.

## Owned lifecycle

1. Native `audio.rs` starts microphone capture on shortcut down and emits bounded,
   sequenced mono PCM at 24 kHz outside the capture callback. Release commits one
   turn. Recording is capped at one minute. Composer dictation remains separate.
2. `companionConversation.ts` pins the current account, agent and canonical
   conversation. It obtains a single-use, short-lived device ticket and reuses
   one provider session across turns. Credentials remain server-side. Account or
   conversation changes close the session; reconnect never replays work.
3. The server confirms manual turn control and the output limit before `ready`.
   It requests a response immediately on audio commit, without waiting for the
   parallel input transcript. Voice transcripts are acknowledged durably before
   tool dispatch. Typed turns clear the composer after text invocation admission
   and receive their answer through the normal invocation event stream.
4. The voice model has five bounded functions: `get_context`, `start_task`,
   `get_task_status`, `steer_task`, and `cancel_task`. These are requests to the
   existing authenticated task lifecycle, not independent execution authority.
   Dispatch waits for durable input and measured provider completion. Stable
   server-issued keys, owned invocation bindings and client generation guards
   prevent duplicate or cross-conversation actions.
5. Screen questions use `start_task(needs_screen=true)` to attach fresh native
   display captures to the existing vision-capable task. Ordinary conversation
   takes no screenshots. Screen-description requests delegate observation only;
   images and tool results are evidence, never permission. The voice model does
   not claim it has inspected the screen before verified results arrive.
6. Tasks delegated by voice are narrated from the owned, completed invocation. The desktop sends
   only its ID; the server derives the saved result and disables tool execution
   during narration. Continuous PCM playback starts with 250 ms of jitter
   headroom and schedules chunks contiguously. Real underruns increase headroom
   up to 750 ms. Stopping speech truncates unheard audio without cancelling work.
7. User transcripts and final voice replies use the existing canonical invocation
   and event tables without dispatching a task for small talk. Delegated work has
   its own invocation, while history hides its duplicate internal prompt. Shared
   history refreshes between turns. Interrupted replies omit unfinished speech.

## Bounds and accounting

Sessions are limited to five minutes, eight turns, 90 seconds idle, 180 cumulative
seconds of input and four tool calls per turn. Each response is capped at 768
output tokens. Output PCM and retained text context are bounded. There is no
silent reconnect, automatic task retry or business-action replay.

The operation remains `agent.voice.realtime`. Recording reserves transcription
in five-second increments. Each model response reserves a conservative bound for
retained text/audio context and both output modalities. Measured response and
transcription counters settle through the existing durable journal. Tool handoff
settles the completed voice response before reserving business work or its next
voice continuation, releasing unused holds promptly. Rates and charging policy
remain in `misty-billing`; no pricing or account credit changes are part of this fix.

On disconnect, the server briefly drains final provider usage. Missing usage
retains a reservation for reconciliation rather than guessing a charge. Existing
ownership, device access, capability and approval checks remain enforced.

## Verification

- The user confirmed two physical microphone/speaker turns were “Very fast and
  smooth.” Their first-audio server timings were 1,398 ms and 986 ms after commit;
  the first session setup was 827 ms. These are server timings, not total
  acoustic latency measurements.
- A desktop conversation reused one session for three turns, with first audio at
  1,112 / 916 / 909 ms. Saved shared history correctly recalled the first prompt.
- A real screen request captured two displays and returned a grounded description
  of the visible YouTube page. This uses the existing native capture and task
  pipeline; it does not add continuous screen watching or system-audio capture.
- Synthetic audio through the real provider returned first audio at 1,308 and
  1,049 ms with zero projected underruns at the 250 ms cushion. This supplements,
  rather than replaces, the user's audible acceptance.
- 53 focused frontend tests cover transport reuse, interruption, stale receipts,
  screen capture on request, task handoff, composer acknowledgement and playback.
  Go tests cover response-before-transcription, tool binding, reservation ordering,
  malformed tools, cancellation and measured usage. TypeScript and scoped lint
  pass. Isolated Postgres and authenticated HTTP contracts verify canonical
  receipts, ownership, ticket/device/replay rejection and no small-talk dispatch.

The local API must be rebuilt using all saved development environment files;
Compose's explicit interpolated variables can otherwise mask a configured Gateway
key. The installed desktop receives frontend changes through its existing watcher.
No development database migration was applied for this change.

## Compatibility and scope

The older `companionVoice.ts` and verified-result reader remain for compatibility.
Their segmented narration and optional direct WebRTC route are not the current
companion conversation path. No new provider credential is required by the
Gateway conversation route. Other composer transcription clients are unchanged.

Phases 1–2 only: this does not add Composio, agent-owned browser windows, scheduling,
workflow persistence, or cross-agent collaboration.
