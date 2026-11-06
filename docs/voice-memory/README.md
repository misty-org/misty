# Misty Voice, Notes and Memory — approved direction

Revision 5 (2026-11-04): no flags, no video of the screen, and recaps in the memory tree. Revision 2
(as built, 2026-10-15): the owner approved the plan on October 14, 2026. This brief records the
direction, the surfaces and the choices made on the plan's open questions. It builds on
the [agents-at-cursor brief](../agents/cursor-companion.md) (revision 3): the island,
the mist and push-to-talk come from it. It also builds on the agent permissions work (Ask/Auto, `agent_grants`, `grants.Decide`, the live
checklist).

Mockups live next to this file:
- [mockup-dictation.html](mockups/dictation.html): the dictation pill
- [mockup-capture-note.html](mockups/capture-note.html): the capture Note with speaker lanes
- [mockup-settings.html](mockups/settings.html): Settings › Voice and Settings › Memory
- [mockup-journal-day.html](mockups/journal-day.html): the Journal day

They follow the approved monochrome palette. The study of OpenWhispr, Anarlog, OpenClicky
and Screenpipe informed the goals only; none of their code or architecture is used.

## Goal

Speak anywhere and have it land where you meant: as text in the field you're typing in,
or as notes from something you heard. See what you did and where you left off in one look, and ask
Misty "what was that, and when?" about anything you did in Misty, and get an answer from your own
history.

## Decisions

1. **On demand, never ambient.** Nothing records the whole computer continuously. The
   microphone is open only while you hold the dictation key, while a capture or live subtitles
   you started are running, or while you talk to the agent at your cursor. Mute is one click away on
   every capture surface. An agent can transcribe a file or a Library item, but it never
   opens the microphone.
2. **Memory is browser-scoped, on by default, with exclusions.** It covers pages visited
   in Misty, agent conversations, voice captures and dictations, notes, drawings,
   downloads. Private windows, excluded sites, sensitive
   categories, secret fields and anything while paused are never recorded. When the
   privacy state is unknown, nothing is recorded.
3. **Voice to notes is general.** Any speech becomes a diarized transcript, and from it
   notes, a summary or action items: dictation, the mic, a Misty tab, system audio or a
   file. It isn't a meetings feature: what it feeds is the browser recap ([Recap](#recap)).
4. **Speech runs in the cloud.**
   - Live audio goes to Soniox realtime, with speaker diarization, through a relay in
     the agent runtime, on the account's Soniox key or the server's.
   - Files and the final pass go through the AI SDK `transcribe` with the Soniox
     provider.
   - Notes, summaries and cleanup use the account's fast model on its own key
     ([byok.md](../byok.md)). There is no local speech model.
5. **Results are cloud items.**
   - Text becomes Notes, Journal and Library items in Postgres.
   - Everything exports to local files.
   - Text is kept until you delete it. Misty keeps no video of the screen.
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
`memory_voice`, `memory_recording` and `memory_note`.

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

There is no "Loading…" text. The pill appears on key-down, before the network is
ready: the microphone's first audio waits in the renderer while the ticket and socket
open (up to 30 s), then goes first.

No warm ticket is held between dictations; the pre-roll covers the ticket's round
trip instead. Saying "Hey <agent name>, …" at the start sends the rest to
that agent instead of typing it, and the pill says where it went.

Insertion:
- Fields in Misty's own window get the text directly, with no clipboard.
- A web page in a Misty tab, like any other app, gets a clipboard paste. The saved
  clipboard is restored unless it changed, and paste waits for the dictation keys to
  be released. Windows terminals get Ctrl+Shift+V; macOS terminals take Cmd+V.
- If Accessibility isn't allowed yet, macOS asks once and the text stays on the
  clipboard.

### Capture panel
A panel opened when listening starts, from Listen in the Journal or "Transcribe this tab". It has
two parts:
- **Your notes:** you type during the capture. These are weighted as the important parts.
- **Transcript lane:** one row per speaker turn. The label is "You" for the mic and
  "Speaker 1", "Speaker 2" for others; click a label to rename that speaker for this capture.

The header carries the source, Mute and Stop. After Stop, four actions appear:
- **Turn into notes:** `voice-notes` in notes mode. Your headings and emphasis survive,
  a template shapes the format but never the facts, and the transcript is attached,
  collapsed.
- **Summarize**
- **Action items**
- **Ask about it:** opens an agent chat with the transcript attached.

A saved capture also becomes a `voice` moment, under the same rules as remembering a page, so a
recap can read it. The moment holds the first part of the transcript; the transcript stays whole.

### Live subtitles
Audeeo's caption panel, without its settings and account pages, opened from More › More tools › Live
subtitles. It floats above every app, fullscreen ones included, and can be dragged and resized. A
rolling line says how the session is set up, and Start subtitles sits in the middle until it's
listening, when Stop moves to the header. The window that opened the panel runs the session and keeps
its choices (`voice.subtitle_preferences`); the panel only draws and asks
(`src/features/voice/subtitles/`, `src-tauri/src/voice/subtitles.rs`).
- **Source:** the microphone, or desktop audio with Misty's own tabs included, or one app that's
  playing. Locked while listening, like Languages, Context and Auto-stop.
- **Languages:** captions, or translation from a source language into a target, this computer's
  language at first. Speech already in the target shows as it was said.
- **Context:** a category, notes, names and terms, and preferred translations, sent to Soniox.
- **Volume:** how loud the input is to Soniox, and mute. Changes apply while listening.
- **Auto-stop:** stops after a chosen time below a chosen level, measured in the opening window.
- **History:** with Save sessions on, each session stays on this computer, in browser storage: the
  newest 100 for 30 days. A session can be exported as text or deleted. With it off, the default,
  nothing is kept. Subtitles never make a transcript, Note or memory moment.
- **How it translates:** Soniox one-way translation in the same live relay, on `stt-rt-v5` and the
  device's Soniox key. The desktop asks for it with `target` in the relay's start message.
- **Left out of Audeeo's panel:** its overlay appearance settings, spoken translation and session
  summaries, which it doesn't offer on a person's own Soniox key either, and filling context from
  the screen.
- **One listener at a time.** Subtitles won't start during a capture, and starting a capture ends
  them and says why. Each window tracks only the panel it opened.

### Recap
Misty's answer to "what did I do, and where did I stop?", in the browser, not for meetings. A handle
on the right edge of the memory tree opens it as a drawer, so the tree stays in view. The tree is the
map; the recap is for reading, one day at a time, with arrows to other days that have
moments.
- **Recap:** one short paragraph on the day, written by itself as the morning brief, with no button.
  It runs `day-summary` on this computer's fast model.
- **What you did:** up to six threads, named by the model, with times taken from the moments it
  points to, never from the model. Clicking one searches the tree for it. With no recap written, as
  today has until tomorrow's brief, the sheet lists the day's sites instead.
- **Next:** up to three things the moments clearly show were left unfinished, or nothing.
- **Morning brief:** the first time the app is open on a new day, after 4 AM local time, Misty writes
  the recap of the last day with moments, once, and its notice opens that day in the sheet. It runs per Space, for the
  window's Space, on the person's own key; Settings › Memory › Morning brief turns it off. It is
  skipped with Memory off or paused, in private windows, and when that day already has a recap or
  this computer has already written it, so a forgotten recap stays forgotten. A failed attempt is
  silent and tries again on the next launch.
- **Kept in the tree.** A recap is a node in the Summaries branch (`ai_recaps`, surface
  `recap-<date>`, with threads and next steps in `outline`), so search, forgetting and `memory.tree.read` work on it. A day has one recap, and
  writing it again replaces it. Summarize in the Journal day runs the same call and keeps the same
  recap.
- **Where you left off:** the day's last page read, one click from reopening. It is read from the
  moments and needs no model.
- **What it reads:** pages, dictation, what Misty heard while listening, and the words read from the
  screen. With Memory off and nothing kept, the column says so and links to Settings › Memory.

There is no screen recording. It was built and removed on November 4, 2026: people want to know what
they did, not to watch it, and Read screen gets that from text alone
([revision 3](#revision-3-screen-capture-sessions-and-the-memory-tree-2026-10-21)). Old `recording`
moments and `recording_item_id` values stay readable.

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

### Settings › Memory (Lucide `History`)
- Memory on/off
- One row per kind
- Morning brief
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

As built in Phase 4 (revision 2):
- The Journal shows the day as a "Day" section beside All, Notes and Pinned. It has a day-by-day
  timeline and a Summarize button.
- Search, "Forget this" on a row, and media in the export are not built yet. Forget
  (last hour, today, everything) and Export (`memory.jsonl` plus a Markdown page per
  day) live in Settings › Memory.
- The summary is the day's recap, kept in the memory tree's Summaries ([Recap](#recap)). Notes get
  their content through the collaborative editor, so a server-written day Note is a follow-up.

## Architecture

Every model call here runs on the runtime on the person's own computer, on that computer's keys
([agents/runtime.md](../agents/runtime.md)); the server stores what comes back, readable, per person
per Space. The vault's guarantee doesn't extend to it.

```
desktop (Tauri)                                   providers
audio-capture ──16 kHz PCM, per channel──▶ runtime in the app (live session) ──▶ Soniox realtime
  Mic | System | Processes(pids)          (opened only by a person's own window)
global_hotkey (down/up)
voice/dictation → insert (page | paste)
                                          runtime in the app (transcribe-diarized) ──▶ Soniox async
                                          local runtime voice-notes, day-summary (fast model)
recall recorder (page_read.js, privacy) ─▶ Go /me/memory/events ─▶ memory_events
                                                                  ─▶ ai_retrieval (memory_*)
```

Memory indexing, as built:
- A trigger on `memory_events` writes each event that has text as a **private**
  retrieval document (owner only, no Space).
- The owner's desktop embeds private documents on the device's embedding model
  (`DeviceEmbeddingWorker`); the server has no embedding worker.
- A second trigger takes the event off `memory_backlog` once its embedding lands.
- General retrieval search (global search, `search.all` and the context broker) excludes
  `memory_*` documents. Only the gated `recall.*` tools search them.
- The page recorder reads the reader article (the same extraction as reader mode). That
  extraction skips forms and fields, so typed values are never read.
- A revisit within 6 simhash bits of the last kept visit stores a pointer, not the text
  again.
- Device settings live in the `recall` section of the settings document. Agent
  preferences already use the name "memory".

- **Capture and segments are Misty's own code.** There is no separate project:
  - the Rust crate `misty-audio-capture` lives at `src-tauri/crates/audio-capture`
    (mic, system and per-process audio, resampling, pre-roll, echo reduction)
  - the TS segment code with speakers lives in `src/features/voice/transcript/` and the
    runtime's `src/live/`
- **Live relay.** The runtime opens one `@soniox/node` `RealtimeSttSession` per channel.
  Each session runs with diarization, endpoint detection, language identification and
  context (the personal dictionary, the page title and attendees). It maps tokens into
  segments (`src/live/segment.ts`).
- **The relay runs on this computer.** It is a session with the runtime inside the app
  (`src-tauri/src/infra/agent_runtime/live.rs`, `agent_runtime_live_open`) on a Tauri channel, and
  needs a Soniox key on the device, which the app gives the runtime whenever one is saved and an
  agent model is usable, whichever transcription model is chosen. Only a person's own window can open
  one, and the server takes no part in it.
- **Wire format.** Binary frames are one channel byte (0 for mic, 1 for system)
  followed by 16 kHz PCM16. Text frames are `start` (language and context) and
  `finish`. The relay sends `ready`, `segment`, `limit`, `error` and `finished`.
- **Models.** Live and diarized transcription run on Soniox's realtime and async models, on
  the device's Soniox key.

## Open questions, decided

1. **Per-tab audio on WebKit.**
   - The first step is a spike: tap the WebContent PID of the tab with
     `Processes([pid])` and check isolation with two tabs playing.
   - WebKit may share one WebContent process between tabs. Where the spike shows sharing,
     "Transcribe this tab" uses the Kiri media capability on the page's media stream
     instead.
   - Result (Phase 3, from reading the engines, not yet run on a device): tab
     audio is not expected to come from the tab's own process. WebKit plays media
     through its shared GPU process, and WebView2 through the shared Edge audio
     service. So `Processes([pid])` on a WebContent or renderer PID would hear
     nothing, and tapping the shared process would hear every tab.
     "Transcribe this tab" therefore always uses the Kiri media tap: the page's
     `<audio>`, `<video>` and call streams go through a WebAudio graph to a
     16 kHz PCM signal. Only a tab that Misty started tapping can send audio.
     Sound keeps playing for the person, and media from another site is skipped
     with a notice, because routing it would mute it. The native PID path still
     needs a check on a Mac with two tabs playing. It stays for "An app".
2. **Echo reduction.** Reference subtraction: an NLMS filter in `misty-audio-capture` that uses
   the system channel as the reference. It needs no third-party AEC and no new license.
   It only runs when both channels are open; mic-only dictation doesn't need it.
3. **Quota numbers.** Every number is configurable on the server, and these are the
   defaults:
   - **Per ticket:** `MISTY_VOICE_LIVE_TICKET_MINUTES` (15) per channel. The relay
     stops at the limit and keeps what was heard.
   - **Memory backlog cap:** `MISTY_RECALL_BACKLOG_CAP=2000` events waiting to embed.
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
No tool opens the microphone. The server's `voice.transcribe` and `voice.to_notes` tools are
gone with its model path: transcribing a file and writing a Note from it happen on the
person's desktop, from the Library and the transcript.

## Flags

There are none. Dictation, voice notes, recaps and Memory are on every app and
every server, and each needs only the person's own setup: a Soniox key for speech, a fast model for
cleanup and recaps, and the Memory switch, on by default, for what gets remembered.

## Tests

- **`misty-audio-capture` and segments:**
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

## Phase 6 as built, and what changed from the plan

The plan assumed the cursor agent worked like this:
- it transcribes speech into a text request
- it sends that request
- it speaks the reply through a separate text-to-speech call

It didn't. The companion ran OpenAI realtime speech-to-speech over one socket
(the server's `/agent-voice/realtime`, removed October 31, 2026; the spoken conversation now
runs in the runtime inside the app, [agents/runtime.md](../agents/runtime.md)):
- Speech is committed as an audio turn. The model's own tools (`show_on_screen`,
  `start_task`) start the work.
- Replies, including task results read back with `task.read`, are spoken as streamed
  realtime audio.
- The screen is captured only when the model asks. Tests assert that holding the key
  captures nothing.

So the upgrades land like this:
- **Memory at the cursor (built).** Cursor runs already get `recall.*` whenever Memory is
  on. The companion prompt now tells the model to call `recall_search` when the person
  refers to something they read, heard or said. It still asks for `recall.read` like any
  other run.
- **Sentence-pipelined speech (not needed).** Realtime audio already starts speaking
  before the reply ends. `[POINT]` and `[GUIDE]` tags are stripped on the server before
  speech (`agentSpeechText`).
- **Partials (not built).** The provider sends no partial transcript of the person's
  speech. Showing partials means running the Soniox relay alongside the realtime
  socket during the hold: a second microphone stream, and a second charge per hold.
  That is a product decision.
- **Speculative send (not built).** A realtime turn is committed audio, so there is no
  text request to send early. The equivalent is enabling the provider's server-side
  turn detection, which changes how hold-to-talk feels. That is also a product
  decision.
- **Key-down look with an 8 s reuse window (not built).** It would reverse the current
  rule that holding the key never captures the screen. The rule is deliberate and
  tested. Reuse would also hand the model a stale screen right after it acted on the
  desktop.
- **screen.look continuing the run (unchanged).** It still ends the run, and the desktop
  continues it with the screen attached. Continuing in place needs a desktop round-trip
  inside a server run.

## Revision 3: tabs and the memory tree (2026-10-21)

Replaced on November 5, 2026: Misty no longer reads the screen. Screen capture sessions, the
window reader and Settings › Memory › Read the screen are gone (the `screen_memory` settings are
pruned at schema 12). What Misty remembers of browsing is what happens in its own tabs: the page
recorder reads the page in front, and every tab that opens is recorded as a visit, so the recap
can tell the whole day. Screen moments already saved stay and can be forgotten like any other.

- **Recorded.** A page in front for 5 seconds is read as an article. Every tab that loads a page,
  in front or not, is also recorded as a visit (address, title, time) without reading it.
- **Always skipped.** Private windows, agent tabs, sign-in and sensitive sites, and sites the
  person lists in Settings › Memory.
- **Memory tree.** The Space's memory is shown as a tree (Space section `memory`) with
  per-node forgetting; agents read the same structure with `memory.tree.read`.

## Interface rules

- The memory tree (`src/features/memory-tree/`, the Space section `memory`) is a React Flow canvas of what a Space remembers: Space, branches (Moments, Summaries, Facts, Workflows), groups, then single memories. It has no page title and no pipeline or health strip; search, a Today/Week/All window and a checkmarked Filter menu sit in one toolbar; right-clicking the Space's card adds a memory or forgets everything; and a details panel on the right is where a node is forgotten, after a count. Glyph tones come from `itemTones` (`memory*` kinds); nodes, edges and selection stay monochrome. The recap opens as a sheet (`RecapSheet.tsx`). Misty does not read the screen.

