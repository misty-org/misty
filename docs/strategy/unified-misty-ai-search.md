# Unified Misty AI search

**Status:** Canonical product memory  
**First proof surface:** Notes  
**Related:** [Misty companion](ai-native-tools/01-misty-companion.md), [Global search](ai-native-tools/02-global-search.md), [Notes / Journal](ai-native-tools/06-notes-journal.md)

## Product contract

Misty has one intelligence layer with two coordinated presentations:

1. **Misty Search** is a stable, top-centred window opened by the Search row or `Cmd/Ctrl+K`. It searches commands, routes, local and cloud objects, offers grounded answers, and can hand work to an audited Agent. Users never choose a Search, Ask, or Action mode.
2. **Misty desktop pet** is a small, draggable, borderless, always-on-top orb that lives outside the main Misty window. It remains available across applications and virtual desktops. Clicking it, the navbar orb, or `Cmd/Ctrl+Shift+K` expands that same orb window into the unified Misty panel; closing the panel collapses the exact window back to the orb at its remembered position.

The pet does not follow the cursor or silently inspect other applications. Its position is remembered locally. The compact composer opens centered on the orb's current location and grows into the result panel only after input begins. Both the orb and expanded panel are shadowless and draggable from the first mouse press, even when Misty is not the active application. Hiding the floating panel leaves answers and Agent runs active, and reopening restores the current work. The in-app and desktop presentations share context references, privacy rules, AI invocations, artifacts, approvals, Agent runs, and history.

## Search interaction

- One input stays mounted while the panel grows downward. Typing must never replace or relocate it.
- Empty input shows only the compact composer. Once the user types, local exact and fuzzy results appear immediately and device and cloud semantic results enrich the same list asynchronously.
- Every outcome is a ranked candidate: object, command, navigation, grounded Misty answer, or Agent task. Enter activates the visible selection, initially the best candidate.
- Strong exact object and command matches win. Conversational intent promotes **Ask Misty**. Explicit delegation or imperative work promotes **Have Misty handle this**. Ambiguous language defaults to an answer.
- Suggested chips filter type, Space, source, and AI intent without becoming query text.
- Context is always receipted. Current surface, selected object or text, capture, privacy boundary, and Agent can be removed before submission.
- Hiding the window never cancels an answer or task. Background work remains available when the window or Agents history is reopened.

## Retrieval and privacy

Misty fuses commands, cached client objects, device lexical search, device semantic search, and the permission-filtered cloud hybrid index. Existing indexed Notes, tasks, roadmaps, calendars, and provider records participate. Ranked lists are fused by canonical identity rather than by comparing unrelated raw scores.

Server semantic search embeds normalized queries, reuses short-lived cached embeddings, and degrades to lexical retrieval when AI, billing, or connectivity is unavailable. Permission and lifecycle filtering happen before ranking. Raw local paths and unattached device content never enter cloud requests.

## Answers and autonomous work

A Misty answer streams in the same panel and cites exact application objects. Navigation requests open the resolved object. Agent-task candidates use the canonical `/ai/runs` runtime, including routing clarification, approval policy, progress, cancellation, durable history, and provenance. Consequential work is never silently applied.

## Notes proof

Inside Notes, an explicit text selection can be attached to Misty and offer Improve, Shorten, or Clarify. Choosing an action creates a tracked inline proposal adjacent to the selection. The original text remains until Accept. Accept uses the immutable selection snapshot, content hash, and revision guard; concurrent edits make the proposal stale. Discard removes it, Retry regenerates it, and accepted changes participate in collaborative Undo. The desktop pet never reads selection or cursor context from another application without a future, explicit permission and capture flow.

The unified composer also accepts a bounded region capture and reusable voice transcription. Voice only populates editable prompt text; it never auto-submits. Search results and citations deep-link to the exact note.

## Voice architecture

Voice input currently records in the desktop WebView and sends the bounded clip to `/v1/agent-voice/transcriptions`; the server then uses its configured AI gateway. It is therefore not offline today. The desktop must declare microphone permission, preserve the panel while the OS permission prompt or recorder is active, retain the recorder's real MIME type, and make transcription failure non-blocking.

The preferred local proof is a downloadable speech pack rather than adding hundreds of megabytes to every installation. Benchmark `sherpa-onnx` as the shared Tauri/Rust host because it supports offline ASR, VAD, and TTS across desktop platforms. Compare its Whisper path with `whisper.cpp` before locking the STT runtime, especially on Apple Silicon and Windows GPUs. Candidate profiles are Moonshine Tiny for a low-resource English pack, Whisper base or small for multilingual dictation, and Kokoro 82M for natural local TTS. Cloud transcription remains the explicit fallback when no local pack is installed or local inference cannot meet the latency target. Model and voice licenses must be reviewed independently; GPL Piper is not a default embedded dependency.

## Deferred work

Cross-application selection capture, cursor-inline proposals outside Notes, new ingestion sources, proactive auto-generation, and a replacement Agent runtime are intentionally deferred. Every non-AI tool must remain useful when retrieval or generation is unavailable.
