# Misty Voice, Notes and Memory — approved direction

Revision 1. The owner approved the plan on October 14, 2026. This brief records the
direction, the surfaces and the choices made on the plan's open questions. It builds on
the [agents-at-cursor brief](../agents-at-cursor/BRIEF.md) (revision 3): the island,
the mist and push-to-talk come from it. It also builds on the agent permissions work on
`agents/permissions-coding-clis` (Ask/Auto, `agent_grants`, `grants.Decide`, the live
checklist).

Mockups live next to this file:
- [mockup-dictation.html](mockup-dictation.html): the dictation pill
- [mockup-capture-note.html](mockup-capture-note.html): the capture Note with speaker lanes
- [mockup-record.html](mockup-record.html): Record
- [mockup-settings.html](mockup-settings.html): Settings › Voice and Settings › Memory
- [mockup-journal-day.html](mockup-journal-day.html): the Journal day

They follow the approved monochrome palette. The study of OpenWhispr, Anarlog, OpenClicky
and Screenpipe informed the goals only; none of their code or architecture is used.

## Goal

Speak anywhere and have it land where you meant: as text in the field you're typing in,
as notes from something you heard, or as a recording you can come back to. Ask Misty
"what was that, and when?" about anything you did in Misty, and get an answer from your
own history.

## Decisions

1. **On demand, never ambient.** Nothing records the whole computer continuously. The
   microphone is open only while you hold the dictation key, while a capture you started
   is running, or while you talk to the agent at your cursor. Mute is one click away on
   every capture surface. An agent can transcribe a file or a Library item, but it never
   opens the microphone.
2. **Memory is browser-scoped, on by default, with exclusions.** It covers pages visited
   in Misty, agent conversations, voice captures and dictations, notes, drawings,
   downloads and capture sessions. Private windows, excluded sites, sensitive
   categories, secret fields and anything while paused are never recorded. When the
   privacy state is unknown, nothing is recorded.
3. **Voice to notes is general.** Any speech becomes a diarized transcript, and from it
   notes, a summary or action items: dictation, the mic, a Misty tab, system audio or a
   file. It isn't a meetings feature.
4. **Speech runs in the cloud, through Audeeo's pipeline.**
   - Live audio goes to Soniox realtime, with speaker diarization, through a relay in
     the agent runtime on Misty's keys.
   - Files and the final pass go through the AI SDK `transcribe` with the Soniox
     provider.
   - Notes, summaries and cleanup go through the AI Gateway. There is no local speech
     model and no BYOK.
5. **Results are cloud items.**
   - Text becomes Notes, Journal and Library items in Postgres; media goes to R2.
   - Everything exports to local files.
   - Text is kept until you delete it, and recordings count toward storage.
6. **Two channels, never mixed.** The microphone and system audio are separate streams
   end to end. The channel says "You" or "someone else"; Soniox diarizes within each
   stream.
7. **Quota stops plainly.** Voice and memory spend the same weekly AI allowance as
   everything else. Past the cap, Misty stops and says what isn't being saved and why.

## Naming

The agent-preference tools `memory.list`, `memory.update`, `memory.remember` and
`memory.forget` already exist (`httpapi/agent_memory_tools.go`). Browsing memory
therefore uses its own namespace in code:
- tools: `recall.search`, `recall.timeline`, `recall.forget`
- grant action: `recall.read`, with scope kind `recall`

People still see "Memory" in Settings, the Journal and the island. The database keeps the
plan's names: `memory_events` and `memory_backlog`, with retrieval kinds `memory_page`,
`memory_voice`, `memory_recording` and `memory_agent_turn`.

## Surfaces

### Dictation pill
Hold Fn/Globe on macOS or Right Alt on Windows (the chord is configurable). Double-tap the
chord to lock hands-free; tap it once more to finish.

The pill sits just below the text caret, or near the cursor when there is no caret. It is
monochrome and shows:
- a level meter
- the live partial text, with provisional words dimmed
- Mute
- once the key is released, a quiet "Cleaning up…" spinner before the text lands

There is no "Loading…" text. The pill appears on key-down from the pre-rolled audio,
before the network is ready. Saying "Hey <agent name>, …" at the start sends the rest to
that agent instead of typing it, and the pill says where it went.

### Capture Note
A Note in your personal Space, opened when a capture starts. It has three parts:
- **Before you started:** a snapshot of the page title, URL and attendees when a meeting
  page is open.
- **Your notes:** you type during the capture. These are weighted as the important
  parts.
- **Transcript lane:** one row per speaker turn. The label is "You" for the mic and
  "Speaker 1", "Speaker 2" for others; click a label to rename that speaker for this Note.

The header carries the sources (Mic, This tab, System audio), Mute, the elapsed time and
Stop. After Stop, four actions appear:
- **Turn into notes:** `voice-notes` in notes mode. Your headings and emphasis survive,
  a template shapes the format but never the facts, and the transcript is attached,
  collapsed.
- **Summarize**
- **Action items**
- **Ask about it:** opens an agent chat with the transcript attached.

### Record
From the island or the toolbar. The picker chooses:
- what to record: a display, a window or a Misty tab
- which audio: Mic, System audio, This tab, plus Mute

The mist and the island show a steady recording ring while it runs. Stop uploads the
video to the Library. The Library item then gets the diarized transcript and a chapter
summary, and becomes a memory event.

### Settings › Voice (Lucide `Mic`)
Plain-list rows:
- Dictation shortcut
- Hands-free double-tap
- AI cleanup
- Style (Plain, Casual, Formal), as a segmented control
- Language, as a checkmarked dropdown
- Personal dictionary
- Hand off to agents by name
- Default capture sources
- Keep recordings

### Settings › Memory (Lucide `History`)
- Memory on/off
- One row per kind
- Excluded sites, as a checkmarked list with add and remove
- Sensitive categories (Banking, Password managers, Health, Misty settings), all on by
  default, each toggleable
- Pause for an hour
- Forget a range
- Delete all memory
- Export

Reset appears only while a value differs from its default. Failures show as plain-language
notices.

### Journal day
A new Journal kind, `day`. It shows a timeline of the day's events, grouped by hour, each
row with the kind's icon tone. Above the timeline sit an AI summary from `day-summary`
and search. Every row has "Forget this", and the header has Export (a zip of Markdown
plus media).

## Architecture

```
desktop (Tauri)                                   cloud
audeeo-core ──16 kHz PCM, per channel──▶ runtime /v1/live/transcribe ──▶ Soniox realtime
  Mic | System | Processes(pids)          (ticket from Go /me/voice/live/ticket,
global_hotkey (down/up)                     voice usage settled on close)
voice/dictation → insert (page | paste)
                                          runtime /v1/models/transcribe-diarized ──▶ Soniox async
                                          runtime voice-notes, day-summary (Gateway)
recall recorder (page_read.js, privacy) ─▶ Go /me/memory/events ─▶ memory_events
                                                                  ─▶ ai_retrieval (memory_*)
```

- **`audeeo-core`** lives in the owner's Audeeo repo (branch `audeeo-core`):
  - the Rust crate `crates/audeeo-core`
  - the TS package `packages/core`, published as `@audeeo/core`

  Misty pins the crate by git rev and vendors the built TS package under
  `vendor/audeeo-core`, recording its rev.
- **Live relay.** The runtime opens one `@soniox/node` `RealtimeSttSession` per channel.
  Each session runs with diarization, endpoint detection, language identification and
  context (the personal dictionary, the page title and attendees). It maps tokens into
  `@audeeo/core` segments.
- **The relay needs a long-lived process.** WebSockets can't be held by Vercel
  functions, so the relay runs on the Docker (node-server) deployment of the runtime.
  The route is off unless `MISTY_RUNTIME_LIVE_TRANSCRIBE=1` and a Soniox key is set.
- **Tickets.** Go signs a short-lived ticket with the runtime control secret: user,
  device, reservation, expiry and nonce. The runtime verifies it statelessly and burns
  the nonce. On close, the runtime settles the measured audio minutes back to Go with a
  signed call.
- **Senses.** `live-transcription` and `diarized-transcription` join `aimodels/config.go`.
  The model ids live in the role defaults, never in callers.

## Open questions, decided

1. **Per-tab audio on WebKit.**
   - The first step is a spike: tap the WebContent PID of the tab with
     `Processes([pid])` and check isolation with two tabs playing.
   - WebKit may share one WebContent process between tabs. Where the spike shows sharing,
     "Transcribe this tab" uses the Kiri media capability on the page's media stream
     instead.
   - Results are recorded under Phase 3 of the roadmap entry.
2. **Echo reduction.** Reference subtraction: an NLMS filter in `audeeo-core` that uses
   the system channel as the reference. It needs no third-party AEC and no new license.
   It only runs when both channels are open; mic-only dictation doesn't need it.
3. **Quota numbers.** Every number is configurable on the server, and these are the
   defaults:
   - **Voice price basis:**
     - live: `MISTY_VOICE_LIVE_UNITS_PER_MINUTE=2000` weighted units (Soniox realtime
       at about $0.12 an hour)
     - files: `MISTY_VOICE_FILE_UNITS_PER_MINUTE=1700`
   - **Weekly voice minutes per tier** (`MISTY_VOICE_WEEKLY_MINUTES`): Basic 120,
     Pro 600, Max 1200, Ultra 6000, Ultra+ 12000. Voice also counts toward the weekly AI
     limit; whichever runs out first stops it.
   - **Memory backlog cap:** `MISTY_MEMORY_BACKLOG_CAP=2000` events waiting to embed.
     Past it the recorder stops and says so.

## Privacy rules

- Recording needs a known privacy state; unknown means no.
- These are never recorded:
  - private windows
  - excluded sites, matched by registrable domain
  - sensitive categories (banking, password managers, health, `misty://settings`)
  - password and payment fields, whose text is dropped by `page_read.js` before it
    leaves the page
  - anything while paused
- Forget the last hour, forget a site, and delete all memory are hard deletes, including
  retrieval documents.
- Memory is never shared through a Space. Search is exact within the account
  (`privacy_class = 'private'`).

## Permissions

These are requested at first use, not at install:
- Microphone at the first dictation.
- Accessibility at the first paste into another app.
- System audio, screen recording and Input Monitoring the first time each is needed.

`Info.plist` gains `NSAudioCaptureUsageDescription` and the screen-capture usage string.

## Agent tools

| Tool | Grant |
|---|---|
| `recall.search {query, from?, to?, kind?, site?}` | read for the owner's own agents; `recall.read` otherwise |
| `recall.timeline {from, to}` | same as `recall.search` |
| `recall.forget {range \| site}` | permission, never rememberable |
| `voice.transcribe {source: tab \| file \| library_item}` | scope-implied for file and Library; permission for live tab or system audio |
| `voice.to_notes {transcript_id, template?}` | scope-implied |

Long jobs publish to the live checklist. No tool opens the microphone.

## Flags

Each phase ships off by default:
- Desktop `publicBetaAvailability` keys: `voiceDictation`, `voiceNotes`, `recall`,
  `captureSessions`.
- Server env: `MISTY_VOICE_LIVE`, `MISTY_RECALL`, `MISTY_CAPTURE_SESSIONS`.
- Runtime: `MISTY_RUNTIME_LIVE_TRANSCRIBE`.

## Tests

- **`audeeo-core`:**
  - Rust: channel separation, pre-roll, resampling, echo reduction.
  - Vitest: segment revisions with speakers.
- **Runtime:**
  - The relay against a recorded Soniox stream fixture.
  - `transcribe-diarized` speaker turns on a two-speaker fixture.
  - `voice-notes` keeps headings and invents nothing.
- **Go:**
  - ticket signing and the voice meter
  - memory RLS isolation
  - simhash pointers
  - privacy rules
  - the `recall.read` grant matrix
  - forget by range and site
  - the backlog cap notice
- **Desktop:** the clipboard-restore race, vocative matching, and releasing modifiers
  before paste.
