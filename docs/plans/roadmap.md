# Misty roadmap

The one place for where Misty is going and what's being built. Decided
2026-10-11. Pricing (plans and meters) lives in the billing repo
(`misty-billing`, `docs/pricing-v2.md`). Competitor facts and parity IDs C1–C18
are in [ai-browser-comparison.md](ai-browser-comparison.md). Everything else here supersedes earlier direction notes.

## Where Misty stands
Claude, Codex, Meta Muse, OpenAI Dots and xAI Grok Bot all automate work, so
"Misty has an agent" is not a reason to choose Misty.

**Positioning:** Misty is your browser, private and made your own, with every
major model built in.

- **Browser first.** Customization, encrypted sync and sign-ins that follow you
  between computers come first and are never traded away. Misty must be worth
  using with no AI at all.
- **Every major model, included.** About 30 makers through the AI Gateway, a
  model per job, and flagships from Pro. People pay Misty for AI because Misty
  does what the AI companies' apps do.
- **Agents work in your browser,** on your computer, signed in as you, and you
  can watch them. Against Muse, Dots and Grok Bot: their agents borrow a
  computer in the cloud; Misty's works in yours.

## Decisions
- **Consumer only.** No team plans, no enterprise (SOC 2, SSO, SCIM, MDM).
- **Open-source desktop app (2026-10-23).** The browser is published as open
  source to earn the trust Zen, Helium and Brave have. Sync, the agent runtime
  and Spaces stay proprietary, as do the server and billing. Spaces are the
  lead against Arc's and Zen's tab sets. Parity C16 (browse with no account),
  C17 (the split and the license) and C18 (Arc import before 2026-12-22).
- **Pricing as in pricing-v2 (billing repo):** Basic free, Pro $12, Max $20, Ultra $100,
  Ultra+ $200. No top-ups.
- **No bring-your-own-AI.** Every model runs on Misty's keys through the
  runtime's AI SDK.
- **Unlimited sync on every plan.** Sync is never a plan limit; rate limits
  handle abuse.
- **No cloud browser.** Misty doesn't chase "runs while your laptop is off".
- **No mobile during the beta.**
- **No MCP server.** Misty doesn't host outside agents (built 2026-10-12, then
  removed the same day: no need for it). Misty's own agents are the way in.
- **Composio** is how Misty's agents reach apps. It can't call Muse, Dots or
  Grok Bot (they have no APIs). A Grok Bot routine tool is parked.

## Work, in order
1. Agents live in Spaces (built 2026-10-12; simplified 2026-10-16, see §1)
2. Workflow parity: C1, C2, C8 (built 2026-10-12, uncommitted; see "Built" in §2)
3. One extension system for Chrome and Firefox add-ons (built 2026-10-12 on macOS,
   uncommitted; see §3)
4. Voice, notes and memory: dictation everywhere, voice to notes, capture sessions
   and browser-scoped recall (approved 2026-10-14; see §4)

Done: unlimited sync (2026-10-11, uncommitted; see the end).

---

## 1. Agents live in Spaces
Agents can now write code, create files and make images, and all of that needs
a home. A Space is that home. Simplified 2026-10-16; the full model is in
[docs/design/spaces-simplified/BRIEF.md](../design/spaces-simplified/BRIEF.md),
which supersedes the first version of this section (one Space per agent, agent
listings with ask/auto/off, the Agents page as a separate chat system).

### Model
- **A Space holds five primitives:** Chat, Notes, Drawings, Files and Code.
  Tasks, roadmaps, the agenda, the Planner, templates and the Library extras
  are gone, with their tables.
- **Owner and members.** Only the owner invites, removes people or deletes the
  Space. No roles, no per-member permissions.
- **Agents are members under a person** (`space_agents`). You bring your agents
  into any Space you're in, and an agent can be in many. When you leave, your
  agents leave too. Everyone keeps a personal Space, created at sign-up.
- **Asking someone else's agent:** @mention it. The run starts at once, sees
  only the Space, reads but never changes the agent's memory, and is billed to
  whoever asked. No accept policy, no approvals; the usual pauses before paying
  or deleting go to the asker.
- **One chat system.** Agent chats are DMs in your personal Space
  (`space_conversations`, same ids as before). Agents reply to each other in
  threads, one hop deep.
- **Artifacts are Files,** credited to the agent and run that made them, with
  live previews. They count against the agent owner's storage.
- **Code projects stay local folders,** linked to a Space
  (`space_code_projects`); others see the changes and the GitHub link. Coding is
  Pro and above.

### Navigation
The tab strip is the only bar; the rail, pills and launcher are gone. ⌘T opens
the panel in a new tab, ⌘L over the current one. It opens URLs, searches the
web, asks an agent (`!ask`, `@agent`) and jumps to any place, with ⌘⏎ for a
split. No ⌘K, no Global Misty.

### Built
- 2026-10-12: the first version (personal Spaces, @mention requests billed to
  the asker, agent artifacts with provenance, code snapshots).
- 2026-10-16: the simplification, in six phases on `worktree-spaces-simplified`
  (prune, agents as members, one chat system, previews and Code, navigation,
  cleanup). Not pushed.

### Still open
- Link a project to a Space from the composer's Project menu.
- Bias the panel's best guess with device-local pick history.
- Show an agent's live work lines in channel replies, not only its answer.

---

## 2. Workflow parity: C1, C2, C8
These close the gaps that stop Misty from claiming "does what Muse, Dots and
Grok Bot do". The IDs come from `ai-browser-comparison.md`.

- **C1 Scheduled tasks that drive the browser.**
  - A schedule runs on the computer it was made on, while Misty is open and the
    computer is awake (keep-awake already exists). There is no computer picker
    (2026-10-19, [agent-chats-local](../design/agent-chats-local/BRIEF.md)).
  - Today scheduled runs get no device (`workflow_schedules.go`).
  - A missed run waits until the computer is back and says so. It never runs in
    the cloud.
- **C2 Stop before paying, sending, deleting or posting, when the person wants that.**
  - Agents act on their own by default (decided 2026-10-12): the person
    watches, and safety comes from site blocks, the sandbox, untrusted page
    content and no typed secrets, not from stops.
  - A narrow check at the native boundary: with "Ask before acting for you"
    on, a page action that pays, sends, deletes or publishes pauses until the
    person confirms in the control island. "Ask before paying" (on by default)
    pauses payments alone.
  - It applies to Misty's agents.
  - It's a small, specific check, not a revival of the retired general approval
    system.
- **C8 Give the agent a task by email or Slack.**
  - Forward an email or mention Misty in Slack to start a task.
  - It runs through the existing Composio Gmail and Slack connections, and the
    answer comes back to the same thread.

### Built (2026-10-12, uncommitted)
- **C2:** the page runtime sorts the control a step acts on into payment,
  send, delete or publish (`P.consequenceKind` in `page_core.js`). For those
  four, `run_step_checked` in Rust waits in `browser_action_confirm.rs` for
  "Allow once" or "Don't allow" in the control island when the job's
  `confirmKinds` (from `app_actions_ask` and `payments_ask`, migration
  `20271012050000_autonomous_agents`) name that kind; a job without them asks
  about all four. The model's `allowConsequential` can't skip a pause, and no
  answer in 3 minutes means no. Other consequential steps run when the agent
  sets `allowConsequential` for a step that's part of the person's task.
  Desktop-control steps follow the same kinds (`askPerson`).
- **C1:** a schedule can name a computer (`workflow_schedules.device_id`,
  migration `20271012030000_scheduled_device_runs`). When it's due, the server
  parks it (`awaiting_device`) instead of running it. Misty on that computer
  checks every minute and on schedule changes
  (`workflows/deviceScheduledRuns.ts`), claims the run and starts it with its
  own signed browser grant. The server only accepts the run with that grant
  and the claim. Runs missed while the computer was away fold into one late
  run, whose conversation says when it was due and how many it covers. The
  computer stays awake for 15 minutes before a run.
- **C8:** Settings › Agents › Connections has switches for email and Slack
  (migration `20271012040000_inbound_tasks`). Email tasks: forward to
  you+misty@… Only mail in your Sent folder counts. Slack tasks: write
  "@misty" in a message of your own. A minute-by-minute check uses Composio's
  proxy to call the Gmail and Slack REST APIs, limited to those two hosts.
  Each message starts one Misty task, and the answer goes back to the thread.
  Slack needs the connection's `search:read` and `chat:write` scopes; a
  missing scope shows in Settings in plain words.

---

## 3. One extension system for Chrome and Firefox add-ons
Built 2026-10-12 (uncommitted, macOS; see `src/features/extensions/DESIGN.md`).

- **No Extensions page.** People add extensions on the Chrome Web Store and
  Firefox Add-ons sites, in an ordinary tab, with "Add to Misty". They turn
  them on and off in the toolbar's Extensions menu and manage them in
  Settings › Browser › Extensions. Old Extensions routes lead there.
- **The page names nothing.** The store button sends a tokened message; Misty
  reads the extension from the tab's real address, downloads it from the
  store and reviews it in its own window.
- **Packages are verified before they unpack.** Firefox: Mozilla's SHA-256 from
  the add-on API. Chrome: the SHA-256 from Google's update service, then the
  CRX3 signatures as Chromium checks them, requiring the extension's developer
  key and the Chrome Web Store's publisher key (`crx.rs`).
- **One runtime:** Kiri's WebExtension layer runs both. `chrome.js` adds Chrome
  side panels (opened in a tab) and offscreen documents (a frame in the
  extension's hidden host page).
- **API coverage:** the layer also provides real bookmarks and tab groups,
  Chrome page rules (declarativeContent), and read-only contentSettings,
  fontSettings and power. WebKit can't support blocking webRequest,
  filterResponseData or proxy, so the full uBlock Origin can't work; uBlock
  Origin Lite does. Second batch: new-tab pages, userScripts (Tampermonkey,
  Violentmonkey) and tab/screen capture through macOS screen sharing.
- **Store takedowns:** an extension its store removed stops running at the
  next update check.
- Approvals, account sync of the installed list, and the agent URL rules
  (`authorize_agent_url`) are unchanged. Agents now name extensions by string
  ID (`extensionId`), and numbers still work.

Still open:
- **Verification:** the top 20 Chrome Web Store extensions by installs (ad
  blocking, password managers, Grammarly-style editors) install and run.
  Where one can't, the review says why in plain language. The ignored
  `store_package_intake` test downloads a sample from both stores.
- Mozilla's add-on signature (PKCS#7 in `META-INF/`) is not checked yet; the
  SHA-256 from Mozilla's API over pinned hosts is.
- Mozilla's blocklist and a Misty-run deny-list are not consulted yet.
- Windows (WebView2), C12 and C13.

---

## 4. Voice, notes and memory
Approved 2026-10-14. The design is
[docs/design/voice-memory/BRIEF.md](../design/voice-memory/BRIEF.md) (revision 2,
with mockups). The work happens on `voice-memory/audeeo-soniox`, which builds on
the agent permissions branch (`agents/permissions-coding-clis`).

Status (2026-10-15): phases 0–6 are on the branch, behind the `voiceDictation`,
`voiceNotes`, `recall` and `captureSessions` flags plus the server switches
`MISTY_VOICE_LIVE` and `MISTY_RECALL`. They are not yet run on a real Mac or
Windows machine. The brief's "as built" notes list what changed from the plan
and what is left.

- **On demand only.** Nothing records the whole computer. The microphone is open
  only while you hold the dictation key, run a capture you started, or talk to
  the agent at your cursor. Agents never open it.
- **Speech runs in the cloud, through Audeeo's pipeline.** Live audio goes to
  Soniox realtime with diarization, through a relay in the agent runtime. Files
  go through the AI SDK `transcribe` with the Soniox provider. Notes and
  summaries go through the Gateway. Everything runs on Misty's keys.
- **Capture comes from `audeeo-core`**, extracted from Audeeo (branch
  `audeeo-core` there): one Rust crate for the mic, system audio and per-process
  audio, and one TS package for segments with speakers.
- **Memory is browser-scoped, on by default, with exclusions.** It covers pages,
  agent turns, voice, recordings, notes, drawings and downloads. The tools are
  `recall.*`, because `memory.*` already means agent preferences.

Phases, each behind a flag:
0. Brief, mockups and the `audeeo-core` extraction.
1. Audio foundation: `audeeo-core` in the desktop app, the runtime relay and
   `transcribe-diarized`, tickets, the voice meter and senses, and
   `global_hotkey.rs`.
2. Dictation everywhere.
3. Voice to notes: the tab-audio spike, four sources, Mute, speaker lanes,
   `voice-notes`, and the `voice.*` tools.
4. Memory: the recorder and its privacy rules, `memory_events`, the retrieval
   kinds, `recall.*` and `recall.read`, the Journal day, and the backlog.
5. Capture sessions (screen recording).
6. Cursor agent upgrades, and the Windows checks in
   [windows-limits.md](windows-limits.md).

---

## Done
**Unlimited sync** (2026-10-11, uncommitted):
- Billing no longer limits `sync.transfer` or counts `sync_bytes` toward storage.
- The server stops reserving sync frames, and migration
  `20271012010000_unlimited_sync_storage` drops the browser-sync storage
  triggers.
- The app and website show unlimited sync.
- Either release order works.

## Parked
**Grok Bot routine tool.** Only matters if people ask to hand work to Grok Bot.
Before any code, confirm in xAI's own docs that a routine webhook exists, what
it returns, and that the terms allow it. If so, it becomes a Composio custom
tool classified as consequential.
