# Companion pointing and teaching ledger

Date: 2026-10-08. Branch: `kura-split` (uncommitted working tree). The Implementation section at the end records what changed. The rest of this ledger is the original static scan of the companion path from capture to model to overlay, compared against the vendored Clicky reference (`vendor/clicky`). Nothing was run live or measured for this ledger.

Confidence labels: **Confirmed** means read directly in the code. **Likely** means the code strongly implies it, but a live run should confirm. **Unmeasured** means it can only be settled by measuring.

## Diagnosis

The companion fails to teach for three separate reasons, and fixing only one will not be enough.

1. **The voice path loses the explanation.** A voice question about the screen goes through three model hops. The final answer, the one that points, arrives as a typed turn that is never spoken, and that turn closes the voice session (L1, L2).
2. **A point cannot show an exact spot.** At the target, the overlay draws the 32px cloud with its center offset from the target, so it covers the element instead of marking it. The bubble shows a random phrase like "right here!" instead of what to do (L3, L4).
3. **The model is told to act, not teach.** The companion persona sits under a general execution prompt that says to plan steps and carry them out with tools. That prompt also includes every capability block. It has no teaching examples and no way to walk through several steps (L5, L6, L9).

Raw coordinate accuracy is probably a real problem too, but nobody has measured it. Measure it first (L7) before tuning it (L8, L10, L11).

## Ledger

| ID | P | Area | Problem | Confidence | Status |
|---|---|---|---|---|---|
| L1 | P0 | Voice flow | The pointing answer is never spoken | Likely | Fixed: the continuation is read aloud; `show_on_screen` also skips the relay |
| L2 | P0 | Voice flow | The `screen_look` continuation closes the voice session | Confirmed | Fixed: voice-owned continuations keep the session |
| L3 | P0 | Overlay | The marker covers the target instead of pinpointing it | Confirmed | Fixed: ring or control outline; the character parks beside it |
| L4 | P1 | Overlay | The bubble shows a random phrase, not the element or the action | Confirmed | Fixed: the bubble types the label, with the step during a walkthrough |
| L5 | P0 | Prompt | The teaching persona is diluted by the execution prompt | Confirmed | Fixed: teaching turns use only the teaching prompt, with no tools |
| L6 | P1 | Prompt | No teaching or pointing examples, and no encouragement to point | Confirmed | Fixed: Clicky's rules and examples, adapted |
| L7 | P0 | Accuracy | No pointing eval, so hit rate is unknown | Confirmed | Built; needs fixtures and a run (see README) |
| L8 | P1 | Accuracy | Possible provider image resize breaks the coordinate space | Unmeasured | Fixed: captures stay inside the provider size limits; the eval measures the rest |
| L9 | P1 | Teaching | One point per answer, with no step-by-step guide mode | Confirmed | Built: `[GUIDE:k/n]`, waits for the target click, then the next step |
| L10 | P1 | Accuracy | No snap to real UI elements (Accessibility) | Confirmed | Built: macOS Accessibility snap (no Windows equivalent yet) |
| L11 | P2 | Accuracy | No refine pass on a zoomed crop | Confirmed | Built: runs when the snap finds nothing; metered, four per answer |
| L12 | P1 | Latency | Two high-reasoning frontier calls before any point | Confirmed | Fixed: one tool-free, low-reasoning look-and-point turn |
| L13 | P2 | Docs | Audio plan names a `needs_screen` tool argument that no longer exists | Confirmed | Fixed |
| L14 | P2 | Verification | Pointing has never had a live acceptance run on one or two displays | Confirmed | Partly done; see Implementation |

## Items

### L1. The pointing answer is never spoken (P0, Likely)

For a voice question like "how do I commit in Xcode?", the realtime model calls `start_task`. That is invocation A. The task model then calls `screen_look`, which ends A without a point. `continueAfterScreenRequest` then submits invocation B with the screenshots through `companion.submit`, which is the typed path ([screenRequests.ts:82](../../src/features/misty/screenRequests.ts)). B is the reply that carries the explanation and the point. Only the delegated task (A) is narrated ([cursorCompanionVoice.ts:175](../../src/features/agents/companion/cursorCompanionVoice.ts)), and typed turns are never narrated. So the user may hear A's stub ("taking a look") and then see a point, but the explanation only shows up as text in Agents.

Fix: when the turn that started the screen request was a voice turn, mark the continuation as voice-owned. Narrate its completed reply, as `settleDelegatedTask` does now, and move `delegatedTask` to B's invocation. A cleaner fix is L12's fast path, which removes the relay entirely.

### L2. The continuation closes the voice session (P0, Confirmed)

`CursorCompanionTyped.submit` calls `s.interruptNative()` and `s.closeConversationVoice()` before it submits ([cursorCompanionTyped.ts:52](../../src/features/agents/companion/cursorCompanionTyped.ts)). Because L1 sends the voice continuation through this path, a voice question about the screen tears down the realtime session in the middle of the conversation. That can also cut off A's narration. The next push-to-talk turn has to open a new session.

Fix: give continuations their own entry that keeps the voice session and its narration, and only interrupts when the user actually started a new typed turn.

### L3. The marker covers the target (P0, Confirmed)

At a point, the overlay moves the sprite's center to the target plus (8, 12) ([CursorCompanionRoot.tsx:165](../../src/features/agents/companion/CursorCompanionRoot.tsx)). The sprite is a 32px cloud with no tip, so it sits on top of the element and hides it, and the user cannot tell which pixel is meant. Clicky's triangle has a tip that the offset aligns with the element, which our mascot doesn't have.

Fix: draw a precise target marker at the exact point, for example a small ring or pulse in the companion's existing signal style. Park the cloud beside it, using the bubble's side so it never overlaps. If L10 lands, outline the snapped element's frame instead of drawing a ring. Keep it inside the companion's local palette (see `DESIGN.md`).

### L4. The bubble ignores the label (P1, Confirmed)

The model sends a label (`[POINT:x,y:label]`), and `resolvePoint` passes it through, but the overlay types a random phrase from a fixed list ([CursorCompanionRoot.tsx:175](../../src/features/agents/companion/CursorCompanionRoot.tsx)). For teaching, the bubble should say what to do, such as "Source Control" or "click Commit".

Fix: type `state.point.label` and fall back to a phrase only when it is empty. Add an optional short action to the tag, for example `[POINT:x,y:label:screenN:action]`, or let the label hold an imperative phrase.

### L5. The teaching persona is diluted (P0, Confirmed)

`aiInvocationSystem` writes the workspace prompt, then the companion prompt, then the agent identity, then `agentExecutionGuidance` ("plan the steps a request needs, carry them out with your tools…"), then every capability block (Spaces, Apps, Desktop, Browser, Screens) ([ai_invocation_system_prompt.go:15-38](../../server/internal/platform/httpapi/ai_invocation_system_prompt.go)). The companion prompt itself says to use tools whenever they help and to take desktop control ([ai_cursor_companion.go:56](../../server/internal/platform/httpapi/ai_cursor_companion.go)). Asked "how do I…", the model is therefore pushed to do the task or open screens instead of explaining where to click.

Fix: classify the request. When the user asks how, where or what (as opposed to "do this for me"), use a teaching prompt: show and explain, point, and do not act. Keep desktop control for explicit action requests. Drop or shorten capability blocks that don't apply to a teaching turn.

### L6. No teaching examples (P1, Confirmed)

Clicky's prompt (`vendor/clicky/leanring-buddy/CompanionManager.swift`, `companionVoiceResponseSystemPrompt`) says to err on the side of pointing. It explains the coordinate space and gives four worked examples, including a point on another screen. Ours gives the tag format and a ban on stale coordinates, with no examples and no instruction about when to point.

Fix: port those rules and examples into the teaching prompt, adapted to Misty's voice. Keep the stale-coordinate rule. Tie it to the eval (L7) so that prompt changes are measured.

### L7. No pointing eval (P0, Confirmed)

There is no fixture set or score for pointing accuracy. The only tests cover parsing and geometry. Every accuracy fix below is guesswork without this.

Fix: build a small offline eval of about 30–50 real screenshots: macOS apps, Misty itself, web pages, two-display layouts. Each comes with a question and a ground-truth target box, which you can take from the Accessibility frame of the expected element. Score the hit rate (point inside the box) and the distance per model and prompt, through the same runtime path (`companionImageParts`). Run it against `openai/gpt-6-astra` and at least one Claude and one Gemini model available through the Gateway.

### L8. Possible image resize by the provider (P1, Unmeasured)

Captures are downscaled to a 1280px long edge ([MistyCompanionCapture.m:52](../../src-tauri/native/macos/MistyCompanionCapture.m)), labeled with those dimensions, and sent as file parts without an image-detail option. The default model is `openai/gpt-6-astra` ([model_catalog_frontier.go:13](../../server/internal/agents/model_catalog_frontier.go)). Some providers resize images before the model sees them. OpenAI's classic high-detail mode, for example, scales the short side to 768px. If that happens, the model sees different pixel dimensions than the label states, and every point is off by a constant factor that grows toward the right and bottom edges. A consistent bias toward the top-left in L7 results would point to this.

Fix: confirm with L7. If confirmed, send an image size the provider won't resize, request full detail through provider options, or ask for coordinates in a normalized 0–1000 space and convert on the client.

### L9. No step-by-step guide mode (P1, Confirmed)

Each answer carries exactly one point, and nothing tracks a multi-step lesson. "Teach me to commit in Xcode" can only point at the first control.

Fix: add a guide flow. The model returns an ordered list of steps (label, short instruction, and a point when the step is visible). The companion shows step 1 and waits for the user's click near the target, or for "next" by voice or keyboard. It then captures again and points at the next step, re-locating it from the fresh screenshot. Show the step count in the bubble ("2 of 4 · click Commit"). The cursor samples already exist in the overlay; detecting the click needs a listen-only mouse-down signal from native, published as position only, the way keyboard activity is published today.

### L10. No snap to real UI elements (P1, Confirmed)

The model's raw coordinates are used as they are. For native apps, macOS Accessibility can report the real frame of the element under or near a point. `MistyAgentPointer.m` already uses `AXUIElementCopyElementAtPosition` for the agent's clicks ([MistyAgentPointer.m:112](../../src-tauri/native/macos/MistyAgentPointer.m)).

Fix: after `resolvePoint`, ask native for the nearest actionable Accessibility element within a small radius (about 40pt) whose title or role matches the label. Snap to its center and outline its frame (L3). Fall back to the raw point when there is no match or Accessibility access is missing. Measure the gain with L7.

### L11. No refine pass (P2, Confirmed)

A single coarse guess on a 1280px image is weak for small controls in dense toolbars. A common fix is to crop around the first guess at native resolution and ask for a refined point in the crop.

Fix: when the target is small or the first guess has low confidence, run a second cheap call on a full-resolution crop of about 400×400 at the guessed point, then map back. Do this only if L10 does not already close the gap on L7.

### L12. Two high-reasoning calls before any point (P1, Confirmed)

In voice, the path is: realtime model → task invocation A (default `high` reasoning, frontier model) → `screen_look` → client capture → invocation B (high reasoning again). Clicky makes one vision call with screenshots captured at the moment of push-to-talk. Ours also adds a full continuation round trip.

Fix: add a fast "look and point" route. When the realtime model decides the question is about the screen, the client captures right away and runs one companion invocation with captures attached and the teaching prompt (L5). Use medium or low reasoning and a model chosen by L7. Its reply is narrated and pointed directly. This also removes the relay behind L1 and L2. Keep the full task path for real work.

### L13. Stale audio plan (P2, Confirmed)

[companion-native-audio.md](companion-native-audio.md) step 5 says screen questions use `start_task(needs_screen=true)`. The tool now takes only `instruction`, and the task decides to call `screen_look` itself ([voice_conversation.go:15](../../server/internal/agents/voice_conversation.go)). Update the plan once L1, L2 and L12 settle.

### L14. No live acceptance (P2, Confirmed)

`DESIGN.md` states that live pointing and voice runs across multiple monitors were never done. The geometry is covered only by unit tests. After L1–L5, run a live pass:

- Ask "where's X?" by voice on one display, then on two displays.
- Ask about a target on the non-cursor display.
- Try a mixed-scale layout.
- Record the time to point and whether the answer was spoken.

## Checked and fine

- The mapping from screenshot pixels to display points and then to the overlay is proportional and consistent (`resolvePoint` in `companionReply.ts`, `CursorCompanionRoot.tsx`). The Clicky port keeps the same maths.
- Captures are labeled with their real pixel size and screen name, both in the user turn (`companion-images.ts`) and in visual tool results (`model-tools.ts`). The server checks that the decoded dimensions match the label.
- Screenshots from a task's visual tool refresh the client's captures through `misty://cursor-captures`, so points from tool-result screenshots resolve against the right image.
- The companion overlay excludes itself from captures (the `Misty cursor` window filter).

## Suggested order

1. L7 eval, so every later change is measured.
2. L3 and L4 overlay marker and label: small, and visible right away.
3. L5 and L6 teaching prompt, then L12 fast path, which also resolves L1 and L2.
4. L10 Accessibility snap, then L8 and L11 only if the eval still shows misses.
5. L9 guide mode.
6. L13 doc update and L14 live acceptance.

## Implementation (2026-10-08)

Every item above has code behind it. What each change does:

- **Teaching turns (L5, L6, L12).** `companion_intent: "teach"` (`ai_invocations.go`, validated in `ai_cursor_companion.go`) needs display captures. Its system prompt is only the companion persona and teaching rules (`companion_teach_prompt.txt`, `companion_teach_turn.txt`), the agent's name and the time. It has no tools: the runtime's `companion_explanation` path and an empty `allowedTools`. Reasoning is `low` when the model supports it, overridable with `MISTY_COMPANION_TEACH_REASONING`. General companion turns keep their tools, and the teaching rules now take precedence for how, where and what questions.
- **Voice (L1, L2, L12).** The realtime model has a sixth tool, `show_on_screen`. The desktop captures every display at once and admits one teaching turn, then points at and reads its answer (`cursorCompanionVoice.ts`). When a spoken task asks for a screen, the request's stub is not read aloud. The continuation keeps the voice session and is the answer pointed at and read. Narration keeps every direction instead of "summarize briefly".
- **Overlay (L3, L4).** `pointLayout.ts` places a ring or the control's outline on the exact spot and parks the character beside it. The bubble types the label, with the step during a walkthrough. Updated in `DESIGN.md`.
- **Accuracy (L8, L10, L11).** Captures use a short side of at most 768 px and a long side of at most 1568 px (`MistyCompanionCapture.m`, `companion_capture_size`). `MistyCompanionPointing.m` snaps to the actionable control nearby, preferring a label match. Otherwise a 280 pt full-resolution crop goes to `POST /me/companion/refine-point/{invocationID}` (`companion_refine_point.go`), and the point moves when the model places it more than 6 pt away.
- **Walkthroughs (L9).** `[GUIDE:k/n]` holds the point. Native forwards click positions only while a step waits (`cursor_companion_watch_clicks`, the `misty://cursor-click` event). A click on the target captures the screen and asks for step k+1 as a teaching continuation (`companionGuide.ts`, `cursorCompanionPointer.ts`).
- **Eval (L7).** `server/apps/agent-runtime/evals/pointing`: `capture-fixtures.ts` builds fixtures from the frontmost app's Accessibility frames, and `npm run eval:pointing` scores models through the production prompt, image labels and model route.

Live checks on this Mac:

- **Eval smoke run.** A synthetic 1188 × 768 git client with nine questions, including one walkthrough, went through `npm run eval:pointing` against `openai/gpt-6-astra` at low reasoning. It hit 9 of 9, with a median miss distance of 0 px and a median latency of 2.8 s. Answers named the control and where it is, used action labels, and the walkthrough question returned `[GUIDE:1/2]`. A synthetic screen is far easier than real ones, so real fixtures are still needed.
- **Refine prompt.** On a 2× crop it returned the exact center (`[POINT:280,148]`) and `[POINT:none]` for a control that does not exist.
- **Voice routing.** `TestVoiceConversationLiveRoutesScreenQuestions` (opt-in, `MISTY_REALTIME_CONVERSATION_LIVE=1`) runs the real realtime model through the server actor with typed turns. It sent "where's the push button on my screen?" and "walk me through committing…" to `show_on_screen`, "push my branch to github for me" to `start_task`, and small talk to no tool. First audio arrived in 0.5–1.2 s.
- **Accessibility snap.** On the real desktop it snapped a point on the Apple menu, and one 14 pt away, to the menu bar item (matched). Points with an unmatched label over no control returned nothing, in 22–110 ms.

Server suite (`.githooks/server-tests.sh`, disposable database): everything passes except `TestScreenModelPassThroughForALiveActJob`. That one fails because another in-progress change raised `screenModelMaxCalls` from 40 to 80 without updating its test, and is unrelated to this work.

Verification: Go tests (`httpapi`, `agents`, route contracts), the agent-runtime suite, the companion, AI surface, Misty and global search Vitest suites, Rust unit tests and `cargo check` on macOS all pass. The Windows click hook was type-checked against the pinned `windows-sys`; a full Windows build was not possible here.

Still open:

- Collect fixtures and run the eval (L7). It needs the person's screen and Gateway credit.
- The live acceptance pass in L14: a spoken "where is…" on one display and then two, a walkthrough by clicks, and a spoken walkthrough.
- A Windows build and an Accessibility equivalent there (UI Automation).
