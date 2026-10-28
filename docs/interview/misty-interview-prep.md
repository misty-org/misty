# Misty: interview prep

A reminder list, not a tutorial. Paths are from the repo root. "Verified" means checked in
the code, docs or git history on 2026-10-28; anything else is flagged.

## 1. Pitches

**30 seconds.** Misty is a desktop browser I'm building on Tauri: Rust shell, React UI, and
the operating system's own web engine (WKWebView on macOS, WebView2 on Windows) instead of a
bundled Chromium. The OS engines render pages but leave out the browser layer, so I wrote one
in Rust, called Kiri: site permissions for camera and mic, a passkey bridge, and Chrome
extension compatibility. On top of the browser, AI agents work in their own tabs beside you. I
built the agent harness myself and measure it on the Odysseys web-agent benchmark.

**2 minutes.**
- *Problem:* AI browsers are either Chromium forks (huge, slow to update, and patches to
  maintain) or extensions with limited access. I wanted a small, native-feeling browser where
  agents are first-class but can never touch your own tabs.
- *Browser:* Tauri app; each tab is a native child webview the Rust shell positions under
  the React chrome. Tabs live in a sidebar, split panes, Spaces (profiles with their own
  color and memory). It works fully signed out; an account is only for sync, Spaces and
  agents.
- *Kiri:* the platform layer the OS webview lacks. Pages reach it through one Tauri command
  (`plugin:kiri|call`); the caller's origin comes from the engine's committed URL, never the
  payload. Engine hooks route camera/mic prompts through one site-permission store. A host
  channel authenticated with a per-tab secret carries Misty's own injected scripts
  (shortcuts, focus, context menu). An extension layer shims the APIs WebKit lacks.
- *Agents:* the loop runs server-side (TypeScript, AI SDK, durable workflow) but all page work
  runs on your machine: the model writes a short JavaScript program, the desktop app runs it
  in a QuickJS sandbox with no network or file access, against a page API that only reaches
  the agent's own tabs. Pay/send/delete/post actions go through a policy gate in the Go API.
- *Harness work:* tools load on demand so the first turn is small, context is compacted on a
  schedule with a cache-friendly stable prompt, and runs checkpoint so a resumed run redoes
  nothing it finished. I measured with Odysseys and fixed harness bugs by failure class.
- *Sync:* end-to-end encrypted. Keys come from the account password on the device (Argon2id
  then HKDF); the server only ever sees a derived login credential and ciphertext.

## 2. Architecture

```
 ┌──────────────────────────── Misty desktop app (one process tree per OS user) ───────────────┐
 │                                                                                             │
 │  React/TS UI (src/)  ── Tauri IPC (invoke, events; per-window capabilities) ──▶ Rust shell   │
 │   sidebar, tabs, panes,                                                         (src-tauri/) │
 │   settings, agent chat                                                           │           │
 │        ▲                                                                         │ creates,  │
 │        │ Zustand stores ─ workspace recovery (encrypted SQLite, keychain key)    │ positions │
 │        │                                                                         ▼           │
 │        │                        native child webviews, one per tab: WKWebView / WebView2      │
 │        │                          │  page JS ── plugin:kiri|call ──▶ Kiri (kiri/, Rust)       │
 │        │                          │              capabilities: media, webauthn (gated)       │
 │        │                          │  engine hooks ─▶ camera/mic → site-permission store      │
 │        └── host channel ◀─────────┘  Misty's injected scripts (per-tab secret): shortcuts,   │
 │                                      focus, context menu, find, passwords, status             │
 │   agent page layer: QuickJS sandbox ─▶ page API ─▶ the agent's own tabs only                 │
 │   misty-browser-sync crate: vault, E2E crypto, local recovery store                          │
 └───────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                         │ HTTPS (cookies in the OS keychain)
 ┌───────────────────────────────────────▼─────────────────────────────────────────────────────┐
 │ Go API (server/): accounts, sync relay (ciphertext only), Spaces, files, memory,             │
 │   agent.gate: tool catalog, policy/approvals, action journal, billing, device job queue      │
 │ Agent runtime (server/apps/agent-runtime): AI SDK loop on a durable workflow; model gateway │
 │ Postgres · Cloudflare Workers (web-fetch fallback, journal collaboration with Yjs)          │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Signed out, nothing below the line is used: browsing, bookmarks, history, downloads,
  passwords and extensions are all local.
- Agent jobs flow server → device: the runtime queues a `browser_run` job, the desktop app
  holds a long-poll claim (up to 25 s) and runs it, and results go back through the gate.

## 3. Key design decisions

### Native OS webviews instead of bundling Chromium
- **What:** Tauri with WKWebView/WebView2; one native child webview per tab.
- **Why:** small binary and memory footprint, engine security updates come with the OS,
  native look, one Rust codebase. A solo developer can't keep a Chromium fork rebased.
- **Alternatives:** Chromium fork (Arc, Brave, Dia), CEF, Electron (`<webview>` or
  `WebContentsView`), Servo/Ladybird (not ready).
- **Trade-offs:** no Chrome extension runtime, no WebAuthn for third-party sites on macOS
  without Apple's restricted entitlement, behaviour differs per engine (WebKit vs Chromium),
  less control over process model and DevTools protocol. Hence Kiri.
- *Follow-up answer:* "Why not Electron?" Electron bundles Chromium too (same size and update
  cost) and its tab story is BrowserView/WebContentsView; you'd still be building a browser
  on Chromium but without the extension system.

### Kiri, the web platform layer
- **What:** a Rust crate that adds what the OS engine leaves out, one capability at a time,
  without rendering anything.
- **Scope today:** camera/microphone permission prompts on all three engines, tab audio and
  capture, the WebAuthn bridge, and the extension layer. Website geolocation and notification
  prompts are not built yet.
- **Four ways in:** page capabilities over one Tauri command; engine hooks (WebKit UI
  delegate, WebView2 `PermissionRequested`); a host channel for the embedder's own scripts;
  a WebExtension layer.
- **Security idea:** the page can call exactly one command; origin and secure-context come
  from the engine, not the request; errors are DOMException names so pages behave as in a
  real browser. Host messages are authenticated with a secret in a closure bound before site
  scripts run, since anything on `plugin:kiri|call` a page could forge.
- **Passkeys:** WKWebView only runs WebAuthn for the app's associated domains; browsers use
  AuthenticationServices' browser API, which needs the restricted
  `com.apple.developer.web-browser.public-key-credential` entitlement. Kiri installs the
  `webauthn` capability only when the running app has it. **Status: the entitlement has not
  been granted yet, so passkeys for arbitrary sites do not work in today's macOS build.**
  WebView2 reaches Windows Hello itself.
- **Trade-offs:** each capability is per engine (three implementations), and some things
  can't be shimmed (e.g. WebKitGTK doesn't report which frame asked for camera).

### Agent harness
- **Small first turn:** every run starts in `answer` with a small tool set;
  `agent_tool_load` adds families (Misty data, connected apps, sub-agents), `agent_tool_use`
  switches toolsets. No router model. (`server/apps/agent-runtime/src/toolsets.ts`)
- **Programs, not clicks:** `browser_run` takes a JS program, so a 10-item list is a loop in
  one call instead of 10 model turns.
- **Context:** stable prompt (page state appended, never rewritten) so the prompt cache
  holds; a working set that cuts old results only when the saving beats the lost cache; a
  condenser that summarizes older steps every 20 turns.
- **Checkpoints:** a ledger of finished vs open items; resume reruns only the open ones, and
  a run that didn't finish shows a "Not finished" table (`docs/agents/checkpoints.md`).
- **Completion is checked:** counts, citations actually opened, kept proof tabs not error
  pages, then one verification turn; loop guard and research budget.
- **Alternatives:** browser-use, Stagehand, OpenAI/Anthropic computer use, cloud browsers
  (Browserbase). Decision: own harness, any model, all browsing local.

### End-to-end encrypted sync
- **Keys:** Argon2id(password, salt = server address + email) → HKDF → login credential +
  vault wrapping key. The server gets the credential, never the password; the wrapping key
  never leaves the device. Key transitions are signed by the vault root and checked against
  the root public key pinned at enrollment, so the server can't swap wrappers.
- **Primitives:** AES-256-GCM with AAD binding each record's key and revision; Argon2id
  (64 MiB, t=3); HKDF-SHA256; Ed25519 for device records and key transitions; `zeroize`;
  keys at rest in the OS keychain (`src-tauri/crates/browser-sync/src/crypto.rs`).
- **What syncs:** the workspace tree (window → tab → pane → view → page), bookmarks and
  collections, website sign-ins; settings never sync (device-local by design).
- **Conflicts:** not a CRDT for browser state. The server does compare-and-set on the
  workspace version; the loser rebases onto the next delta and retries
  (`workspace/sync/receipts.rs`). Website sign-ins have a single writer (a lease holder);
  stale holders' writes are dropped. Replays are ordered and gap-checked; an older batch never
  replaces a newer one. Notes use Yjs (CRDT) in a Cloudflare Worker, and those are **not**
  end-to-end encrypted.
- **Local recovery:** each profile's workspace is also saved in an encrypted SQLite store on
  the device with a keychain key, so restore never depends on the server.
- **Known limits (be honest):** a password change doesn't rotate the vault key; a malicious
  server could still learn a legacy account's typed password once; sign-in lockout is in
  memory.

### Process and security model
- **Process:** one app process; WebKit runs each page in its own WebContent process (site
  isolation is WebKit's); WebView2 has its own browser/renderer processes.
- **IPC trust:** Tauri capabilities give website webviews only `kiri:default`; the app
  window gets the app commands. Commands that touch recovery check they're called from the
  main window.
- **Agents:** act only in their own tabs; programs run in QuickJS with no network, files or
  globals; consequential actions (pay, send, delete, post) pass a policy gate; grants are
  leased and expire; sub-agents inherit the parent's grants, never more.
- **Coding:** handed to the person's own coding CLI (Claude Code, Codex…) through its
  permission protocol, never with bypass flags (a test pins this). Seatbelt now sandboxes the
  documents worker (`infra/documents/worker_macos.rs`); the old Seatbelt coding harness was
  removed.
- **`web.fetch`:** no cookies, and every address and redirect must be public (SSRF guard).
- **Prompt injection:** page text is data in tool results; the gate, not the model, decides
  what a tool may do; the agent can't reach your signed-in tabs; risky actions can ask first.

## 4. Defending the resume bullets

Git note: HEAD's history was squashed on 2026-10-23. The step-by-step commits are in the tag
`backup/pre-squash-2026-10-23`; commit hashes in `docs/agents/evals/odysseys.md` resolve, but
they aren't ancestors of `main`. Use `git log backup/pre-squash-2026-10-23 -S "<text>"`.
Full evidence notes from this audit: the coordinating session's notes folder,
`misty-evidence.md`.

### Bullet 1: "agentic desktop browser on native OS webviews with a custom layer for passkeys, permission prompts, device APIs and Chrome extension compatibility"

**Verdict: mostly true, but the wording claims more than ships today.**
- **Native webviews:** true. Tauri plus WKWebView/WebView2; one native child webview per tab
  (`src-tauri/src/infra/browser/create/`).
- **Kiri:** `kiri/` (about 6,200 lines of Rust and JS), documented in `kiri/README.md`; status
  table there ("Ran in app" on macOS for phases 1, 2 and 4).
- **Passkeys:** the macOS WebAuthn bridge is built (`kiri/src/capabilities/webauthn/`, about
  1,450 lines plus `shim.js`) on AuthenticationServices' browser API, but it **only switches
  on with Apple's restricted entitlement, which hasn't been granted**. So it doesn't run in
  current builds. Windows passkeys come from WebView2 itself (not your code).
- **Permission prompts:** camera and microphone on all three engines (`kiri/src/permissions.rs`,
  `kiri/src/engine/`, `src-tauri/src/infra/site_settings/permissions/`). **Website geolocation
  and notification prompts are not built.**
- **Device APIs:** in practice camera, microphone and tab audio/capture (`kiri/src/capabilities/media/`).
  No geolocation, WebUSB, HID, Bluetooth or MIDI.
- **Chrome extensions:** MV3 only. macOS: the system `WKWebExtension` runtime plus Kiri's
  compatibility shims (`kiri/src/extensions/compat/*.js`, about 2,200 lines: downloads,
  history, bookmarks, tabGroups, notifications, sidePanel-as-tab, offscreen documents,
  userScripts…). Windows: WebView2's own extension support. Install verifies the CRX3
  signature like Chromium (`src-tauri/src/infra/extensions/crx/mod.rs`, publisher key pinned).
  Can't do blocking `webRequest` on WebKit, so uBlock Origin Lite works but full uBO doesn't.
- **How to show it:** open `kiri/README.md` "Four ways in"; the `plugin:kiri|call` flow
  (origin from the engine, not the payload); `src-tauri/capabilities/kiri.json` (website
  webviews get only `kiri:default`).
- **Suggested wording:** "Building an agentic desktop browser on native OS webviews
  (WKWebView, WebView2), with a Rust web-platform layer for site permissions, camera and
  microphone, a WebAuthn passkey bridge, and Chrome MV3 extension compatibility with CRX3
  signature verification."
  If asked about passkeys: "built and tested, waiting on Apple's browser entitlement."

### Bullet 2: "Cut agent first-turn prompt size by 51% from 22,000 to 10,700 tokens by loading tools on demand and building an agent harness with context compaction and resumable checkpoints"

**Verdict: the number is real; the causal wording is off.**
- **Source:** `docs/agents/evals/odysseys.md` ("Comparison pass A (October 19)"): "Misty's own
  tools deferred (first turn 22,000 → 10,700 input tokens)". Original commit `48f0886aa`
  (2026-10-19) in the backup tag; on `main` via `230dbf159`.
- **Independent check** against the local billing ledger (`billing.usage_receipts`): median
  first agent turn 21,700–22,000 tokens on Oct 19 03:00–10:00 UTC (Haiku 5.5, 45 runs), then
  10,818 when pass A started at 11:00 (7 runs). 22,000 → 10,700 is −51.4%.
- **What caused it:** deferring Misty's own data tools only, about 50 of a run's 65 tools
  and roughly 9,000 tokens (`server/apps/agent-runtime/src/toolsets.ts:17`, `agent_tool_load`
  and `agent_tool_use`; tests in `test/toolsets.test.ts`). Compaction and checkpoints are real
  but separate; they don't touch the first turn.
- **Compaction:** `src/context/condenser.ts`, one interface over five stages (stale snapshots
  → working set digests above 24k tokens → keep last 4 tool results past 60% of the window →
  periodic summary every 20 turns → model summary past 80%). Tests: `test/condenser.test.ts`
  and friends.
- **Checkpoints:** requirements ledger with evidence-backed resume (`src/ledger.ts`, tool
  `agent_ledger`; a `done` row without evidence goes back to `pending`), eval resume
  (`MISTY_ODYSSEYS_RESUME`, `RESUME_FAILED`), and durable workflow steps (Vercel Workflow;
  `CheckpointWorkflowStep` in the Go API).
- **Reproduce:**
  1. With the stack up, the runtime logs a `context_breakdown` line per turn (system chars,
     tool chars, tools sent vs catalog): `docker logs misty-server-agent-runtime-1 | grep context_breakdown`.
  2. Ledger query (read-only):
     ```sql
     WITH t AS (SELECT split_part(key,':',2) inv, created_at,
       (request->'usage'->'units'->>'input_tokens')::int
       + coalesce((request->'usage'->'units'->>'cached_input_tokens')::int,0) tot
       FROM billing.usage_receipts WHERE action='settle'
       AND request->>'operation'='agent.model' AND key LIKE 'agent-runtime:invocation_%'),
     f AS (SELECT DISTINCT ON (inv) inv, created_at, tot FROM t WHERE tot>3000 ORDER BY inv, created_at)
     SELECT date_trunc('hour',created_at), count(*),
       percentile_cont(0.5) WITHIN GROUP (ORDER BY tot) FROM f GROUP BY 1 ORDER BY 1;
     ```
     via `docker exec misty-billing-postgres-1 psql -U billing_owner -d misty_billing -c "…"`.
  3. For a clean A/B: run the same Odysseys task at the commit before and after the deferral.
- **Weak point to own:** it's a before/after across time, not a controlled A/B, and the doc
  rounds. Per-turn median input also fell 82,000 → 49,000 in the same pass.
- **Suggested wording:** "Cut the agent's first-turn prompt by 51% (≈22,000 → 10,700 tokens)
  by loading rarely used tool families on demand; built context compaction (a five-stage
  condenser) and evidence-backed resumable checkpoints for long runs."

### Bullet 3: "Improved Nemotron 3.5 Super VL from 4 to 11 of 16 completed tasks on the Odysseys web-agent benchmark by classifying failures and fixing the harness bugs behind them across 20+ iterations"

**Verdict: partly supported. "11 of 16" holds up; "from 4" has no source; "completed" is
the wrong word.**
- **Model:** `nim/nvidia/nemotron-3.5-super-vl-120b-a12b` (NVIDIA NIM free endpoint; 120B,
  12B active). Chosen because GLM-5.3-Flash accepted at most 8 images per prompt on NIM and
  failed the judge (`docs/agents/evals/free-model.md`, `odysseys.md`).
- **Where the numbers are:** only in the gitignored local reports,
  `server/apps/agent-runtime/evals/odysseys/reports/*/report.json` (50 Nemotron folders, 45
  graded runs, 2026-10-21 to 22). Not in any doc or commit. **Back them up** (copy the
  reports somewhere safe) before you cite them.
- **What they show:** of the 16 tasks tried on Oct 21, 11 reached a perfect rubric score at
  least once; 7 were perfect on the first graded attempt, 9 on the last. Including Oct 22,
  13 of 18.
- **"From 4":** can't be derived from the reports. If the 4 came from an earlier pass you
  remember, find it; otherwise drop it.
- **"20+ iterations":** true for the campaign as a whole: about 23 logged iterations, 50
  labelled failure causes (27 harness, 12 eval, 5 page layer, 6 mixed) in `odysseys.md`
  ("The loop": P perception, A action, R reasoning, H harness, E eval, K page layer). But most
  of those iterations ran on Haiku 5.5, not Nemotron.
- **Caveats an interviewer may probe:**
  - Best-of-N with fixes between attempts, not one fixed pass; the campaign's own rule is
    that the full run is the score.
  - 15 of 18 tasks were easy.
  - Holdout tasks were used for iteration, against the campaign's rule.
  - The judge changed partway: Nemotron self-judging, then Gemini 3.1 Flash-Lite.
  - Big run-to-run variance (the doc shows 0.75 / 0.50 / 0.75 on near-identical code).
  - "Completed" in the reports isn't "perfect": two perfect runs ended with status `failed`.
- **Fixes you can name** (each a commit in the backup tag): agent tabs that keep painting
  when hidden; acting inside cross-origin frames; long-lived background leases; research
  budget scaled to the request's checklist; requirements ledger at run start; refusing early
  give-ups; IPv4-first provider calls; consent-banner decline; parallel tool calls; repairing
  garbled document IDs; DNS check on guessed domains; waiting for new tabs to load; a
  progress watchdog instead of a wall clock; not mistaking narration for the answer.
- **Rerun:** `server/apps/agent-runtime/evals/odysseys/README.md`. In short: NVIDIA key in
  `server/.env/dev/integrations/ai.env`, `MISTY_ALLOW_MODEL_OVERRIDE=1`; `misty server up`;
  start the desktop with `MISTY_BROWSER_EVAL_BRIDGE_PORT`/`_TOKEN` and
  `MISTY_EVAL_EPHEMERAL_PAGES=1`; then from `server/apps/agent-runtime`:
  `MISTY_ODYSSEYS=1 MISTY_ODYSSEYS_MODEL=nim/nvidia/nemotron-3.5-super-vl-120b-a12b MISTY_ODYSSEYS_JUDGE=gemini/gemini-3.1-flash-lite MISTY_ODYSSEYS_TASKS=<ids> … npm run eval:odysseys`.
  Restart the app before each pass (a WebKit page-process leak is still open).
- **Suggested wording:** "Ran a failure-driven eval loop on the Odysseys long-horizon web
  benchmark: classified every failure (perception, action, reasoning, harness, eval) and
  fixed the harness causes across 20+ iterations; with NVIDIA's Nemotron 3.5 Super VL, 11 of
  16 attempted tasks reached a perfect rubric score."

## 5. Likely questions, with answer pointers

**Deep dive: browser**
1. *How does a tab work?* A native child webview per tab, created and positioned by Rust
   (`src-tauri/src/infra/browser/create/`); React reports the pane's rect; the webview is
   created when its pane is laid out and visible.
2. *How do shortcuts work when a web page has focus?* The native menu's accelerators fire
   before any webview (`src-tauri/src/infra/app_menu.rs`); the rest are caught by an injected
   page script and sent over the authenticated host channel (`browser_shortcuts.rs`).
3. *Why can't a page fake those messages?* The host channel's secret lives in a closure bound
   before site scripts run; Kiri hands the raw string to the embedder to authenticate.
4. *How do you restore a session after a crash?* Workspace state (windows → tabs → panes) is
   written to an encrypted SQLite recovery store on every change, revisioned, with pending
   slots for writes that haven't landed; quit waits for unsaved keys
   (`infra/workspace_recovery.rs`, `features/workspace/nativeWorkspaceRecovery.ts`).
5. *A bug you found in it?* Story: tabs vanished after relaunch for an account whose session
   had expired. Recovery asked the server cookie store to confirm the account on every read
   and write; with a dead session it fell back to an in-memory workspace. Fix: recovery is
   device data, so derive its identity from the API URL alone (commit on `overnight-stability`).
6. *How do camera/mic prompts work on WKWebView?* Kiri installs a WebKit UI-delegate hook;
   each request carries the frame's origin; one site-permission store answers; a block applies
   to embedded frames, an allow never crosses origins.
7. *Passkeys?* Needs Apple's restricted browser entitlement; capability installs only when the
   signed app has it. Not granted yet, so be upfront.
8. *Chrome extensions on WebKit?* MV3 packages, CRX3 signature check on install, a shim layer
   for the `chrome.*` APIs WebKit lacks, relayed to the host which checks granted permissions.
9. *Memory with many tabs?* One WebKit content process per page; hidden tabs are `setHidden`
   on macOS so WebKit throttles them (on Windows, stacked under the renderer and put to sleep
   after a minute). Measured overnight: 15 real tabs ≈ 1.3 GB total; measure with the debug
   bridge's `/processes` route and `ps`.

**System design follow-ups**
10. *How does sync handle conflicts?* Optimistic concurrency: the server compare-and-sets the
    workspace version and the losing device rebases its delta and retries; replays are ordered
    and gap-checked. Website sign-ins avoid conflicts with a single-writer lease. Notes use Yjs
    (CRDT). Be ready to say why CAS + rebase is enough for tabs but text needs a CRDT.
11. *What does the server see?* Ciphertext, record ids, sizes and timing; account email; never
    the password or vault key.
12. *Key rotation / device loss?* Wrappers per account; transitions signed by the vault root;
    devices pin the root key. Password change re-seals but doesn't rotate the vault key (known
    gap).
13. *How do you sandbox an agent acting on pages?* Own tabs only; QuickJS with no network,
    files or globals; page API is the only surface; time and operation caps; consequential
    actions gated server-side; grants leased per task and expire.
14. *Prompt injection?* Pages are untrusted data in tool results; the model can't widen its
    own permissions (the gate decides); the agent can't see your signed-in tabs; pay/send/
    delete/post can require approval; completion checks verify claims against what was opened.
15. *Scale the agent runtime?* Durable workflow per run (resumable), device jobs on a queue
    with long-poll claims, stateless Go API in front of Postgres; model calls through a
    gateway.
16. *Offline / no account?* Everything browsing-related is local; sign-in only for sync,
    Spaces and agents.

**LLM and evals**
17. *How did you cut the first-turn prompt?* Deferred tool families loaded by
    `agent_tool_load`; small default toolset; see section 4 for the numbers and how to
    re-measure.
18. *Why is a stable prompt prefix important?* Prompt caching: rewriting earlier messages
    invalidates the cache; append-only page state keeps cache hits high.
19. *Compaction vs truncation?* Summarize older turns every 20 turns past budget; cut old
    results only if the saving beats the lost cache; keep tool state and the notebook.
20. *What's a checkpoint here?* A ledger of finished and open items; resume redoes only open
    ones.
21. *Eval methodology?* Odysseys tasks on live sites; iterate on a cheap model with a cheap
    judge after every change, check on the dev split with the official judge, report on the
    full set. Classify each failure (harness bug vs model limit vs site) before fixing.
22. *How do you know an improvement isn't noise?* Same task set, re-runs, per-task diffs,
    and judging with a separate model; admit small-n variance (16 tasks).
23. *LLM-as-judge risks?* Self-preference, leniency; never put the free judge's scores next
    to the leaderboard's.
24. *Why programs instead of one action per turn?* Fewer turns, fewer tokens, loops and
    waits are deterministic.

**Security**
25. *Tauri IPC security?* Per-window capabilities; website webviews get only `kiri:default`;
    recovery commands check the caller is the main window.
26. *Where are secrets stored?* OS keychain (cookies, recovery root key, vault key if
    remembered); never in localStorage.
27. *Why Argon2id + HKDF?* Memory-hard stretch of a low-entropy password, then independent
    keys for login vs encryption so the server's credential can't decrypt.

**Debugging stories**
28. Expired-session tabs lost (above): found by reading recovery state through a debug bridge.
29. Testing at night with the screen locked: a hidden window never created its page views
    and the launch overlay never faded (both wait on frames/animations). Lesson: know what your
    test harness can and can't observe before trusting a negative result.
30. Push-guard race: a shared hook rewritten in place could be read empty mid-write; atomic
    write + rename. Found from a flaky test.
31. WebKit never reports a finished load for some failed/cancelled navigations (YouTube); the
    status script treats DOMContentLoaded + 4 s as loaded so spinners stop.

**Reflection and behavioural**
32. *What would you do differently?* Fewer features before stability (agents, voice, Spaces
    landed before session restore was rock solid); an end-to-end smoke test that launches the
    app; CI instead of local-only hooks; smaller files earlier.
33. *Hardest trade-off?* Native webviews: smaller and safer to maintain, but every web
    platform gap (passkeys, extensions) became my problem.
34. *How did you use AI tools?* Heavily for implementation speed; I own the architecture,
    the reviews and the debugging; give one example where you caught a wrong AI change.
35. *How do you prioritise solo?* Written briefs per feature (`docs/`), approved before
    building; a roadmap with one plan.
36. *Something you cut?* Self-hosting, MCP connectors, BYOK, a built-in ad blocker (use
    uBlock Origin Lite via extensions), Arc import.
37. *What are you proud of?* The trust boundaries: one IPC command for pages, the agent's
    own tabs, and keys that never leave the device.

## 6. Concepts to review

- **IPC:** Tauri invoke/events, capabilities and scopes; WKScriptMessageHandler; WebView2
  `WebMessageReceived`; trust boundaries between renderer and host.
- **Browser process models:** Chromium's site isolation (browser, renderer, GPU, network
  processes); WebKit's UI process + WebContent + Networking processes; out-of-process iframes.
- **Web security:** same-origin policy, secure contexts, CSP, Permissions Policy, iframes and
  origin of the requesting frame.
- **WebAuthn:** relying party ID, challenge, attestation vs assertion, platform vs roaming
  authenticators, discoverable credentials, conditional mediation, Apple's browser API.
- **Sync:** last-writer-wins, vector clocks, CRDTs (Yjs, RGA/YATA), operational transform,
  idempotent replay, tombstones.
- **E2E encryption basics:** KDFs (Argon2id, scrypt, PBKDF2), HKDF, AEAD (AES-GCM,
  XChaCha20-Poly1305), key wrapping, signatures (Ed25519), key pinning, forward secrecy (and
  why vault sync doesn't have it).
- **LLM context management:** tokens and context windows, prompt caching (prefix stability),
  summarisation/compaction, retrieval, tool-result truncation.
- **Tool calling:** JSON-schema tools, deferred/lazy tool loading, parallel calls, error
  surfacing to the model, MCP.
- **Evaluation methodology:** benchmarks for web agents (WebArena, Mind2Web, WebVoyager,
  Odysseys), LLM-as-judge pitfalls, variance and small samples, ablations, failure taxonomies.
- **Concurrency:** file locks, SQLite WAL, atomic rename, races in tests vs production.
- **Rust:** ownership in async (`spawn_blocking`, `OnceLock`, `Mutex`), FFI with objc2/COM.

## 7. Daily-driver status (overnight run, 2026-10-28)

How it was checked: the debug app (`misty desktop dev`) with the debug-only eval bridge
(`MISTY_BROWSER_EVAL_BRIDGE_PORT`/`_TOKEN`), which lists pages, evaluates JS and reads the
WebKit page processes; accessibility-tree clicks; and stack samples. The screen locked part
way through, which stops a hidden window from creating pages and blocks synthetic keystrokes,
so the later checks were driven through the app's stores.

**Fixed (branch `overnight-stability`)**
- `f2bf111cb` Tabs were lost on every relaunch for an account whose session had expired (the
  account row reads "Sign in again"). Workspace recovery asked the server cookie store to
  confirm the account on every read and write, failed, and fell back to an in-memory
  workspace. Verified: three tabs survive a clean quit and relaunch, and a rebuild-restart.
- `b3b3fc2e4` The commit hook's Windows cross-check failed on `main`: two probe examples
  include `webview2.rs` by path and couldn't find its `page` module.
- `c084214aa` A race in the coding-tool push guard: the shared `pre-push` hook was rewritten
  in place, so a tool starting at the same moment could run an empty (passing) hook. It
  showed up as a flaky engine test. Now written and renamed into place.

**Verified working**
- Welcome → import skip → extensions → tab side → browser, with no sign-in.
- Address bar: typed hosts (`example.com`, `github.com/tauri-apps/tauri`) open as URLs.
- Real sites: Google, GitHub, Wikipedia, YouTube (video plays: `readyState` 4, time advancing),
  Hacker News, Reddit, MDN, NYT, BBC, Stack Overflow, Apple, docs.rs, X, Amazon.
- Session restore after a clean quit (tabs and the active tab), with the fix above.
- Cmd-1 and Cmd-9 (select first and last tab), and Cmd-T and the Window › New Tab menu
  item when the app's own UI has focus.
- 15 real tabs idle: about 1.3 GB in total (app 121 MB plus 16 WebKit page processes,
  21–199 MB each). Page processes sit at about 0% CPU. No runaway processes.
- A release build: `npm run tauri -- build --bundles app` builds in about 5 minutes, launches
  and idles at about 2% CPU.
- Commit hooks green for the three commits. `misty check app`: see the final message.

**Not verified or still flaky**
- **Idle CPU of the debug app with 15 tabs is about 20%.** Samples show mostly waiting threads
  and WebKit display-link threads; it's a debug build. Re-measure on the release build with the
  screen unlocked.
- **Cmd-T right after launch, while a restored page holds focus, didn't open the New Tab
  panel once.** The screen was locked at that point, so the keystroke may never have arrived.
  Retest: launch, click into a page, press Cmd-T.
- Not reached (screen locked): Cmd-W/L/R/[/]/Shift-T, find in page, zoom, YouTube
  fullscreen (`document.fullscreenEnabled` is true; WebKit's own fullscreen window is used),
  file upload and download, split panes, Spaces switching, bookmarks and history UI.
- A truly signed-out first run: every dev profile shares the keychain, where an expired
  session is saved, so even a fresh profile shows "Sign in again". Signing out would have
  touched your real saved session, so it wasn't done.
- **Passkeys don't work in today's macOS build** (Apple's browser entitlement isn't granted;
  WebKit's default applies). **Website geolocation and notification prompts aren't built.**
- Agents: not exercised (they need a signed-in session). Signed out or expired, the agent UI
  doesn't mount, so it can't disturb browsing. No gating was added.
- Flaky test left alone: `infra::browser_sync::tests::account_replacement_waits_for_key_owner_and_releases_process_lock`
  failed once, passed on the other runs (process-global state shared by parallel tests).

**Daily-driver build**
```bash
cd ~/misty-org/misty && git switch overnight-stability
npm run tauri -- build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
codesign --force --sign "Apple Development" --identifier com.misty.desktop.development --timestamp=none src-tauri/target/release/bundle/macos/Misty.app
open src-tauri/target/release/bundle/macos/Misty.app
```
The re-sign gives the release app the same code identity as `misty desktop dev`, so it reads
the same Keychain items (website cookies, the workspace recovery key) without prompts. If
several "Apple Development" certificates exist, use the SHA-1 from
`security find-identity -v -p codesigning`. It points at the API in `.env`. For development,
`misty desktop dev` is unchanged.

## Decisions made overnight

- Fast-forwarded `main` (3 commits, clean) and worked on a local branch
  `overnight-stability`. Nothing was pushed, released or deployed.
- Recovery no longer asks the server whether the account's session is alive. It's device
  data sealed with a keychain key, and the frontend already scopes it to the account. I judged
  losing tabs worse than the theoretical risk of one account's window writing its own
  recovery while another account's cookies are loaded.
- Fixed the Windows probe compile error rather than skipping the hook, since every commit
  runs it.
- Fixed the push-guard race (a security-relevant flake) instead of retrying the test. Left
  the browser-sync lock test alone (it passed on reruns; the fix needs more context).
- Didn't add features: no geolocation/notification prompts, no passkey workaround, no
  agent gating (agents already don't mount without a valid account).
- Didn't sign in, sign out or touch the keychain, `~/misty-backup.agekey` or secrets. The
  release build was re-signed with your existing Apple Development certificate (the same one
  dev builds use) and run once.
- Resume bullets: the numbers I couldn't trace are flagged in section 4 with suggested
  wording; I didn't change your resume.
- The Nemotron reports that back bullet 3 live only in a gitignored folder
  (`server/apps/agent-runtime/evals/odysseys/reports/`). Copy them somewhere safe.
