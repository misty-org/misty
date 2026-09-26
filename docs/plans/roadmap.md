# Misty roadmap

The one place for where Misty is going and what's being built. Decided
2026-10-11. Reference data lives in two linked docs:
[pricing-v2.md](pricing-v2.md) (plans and meters) and
[ai-browser-comparison.md](ai-browser-comparison.md) (competitor facts and parity
IDs C1–C15). Everything else here supersedes earlier direction notes.

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
- **Pricing as in pricing-v2:** Basic free, Pro $12, Max $20, Ultra $100,
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
1. Agents live in Spaces (built 2026-10-12, uncommitted; see "Built" in §1)
2. Workflow parity: C1, C2, C8 (built 2026-10-12, uncommitted; see "Built" in §2)
3. One extension system for Chrome and Firefox add-ons (built 2026-10-12 on macOS,
   uncommitted; see §3)
4. Voice, notes and memory: dictation everywhere, voice to notes, capture sessions
   and browser-scoped recall (approved 2026-10-14; see §4)

Done: unlimited sync (2026-10-11, uncommitted; see the end).

---

## 1. Agents live in Spaces
Agents can now write code, create files and make images, and all of that needs
a home. A Space is that home.

### Model
- **Every agent belongs to exactly one Space.** Several agents can share a
  Space. An agent never needs more than one, because agents can talk to each
  other.
- **Everyone gets a personal Space,** named after them ("Matthew's Space"). Its
  members start as the person and their agents. It's created at sign-up and by a
  migration for existing accounts.
- **New agents** pick a Space when they're created; the default is the personal
  Space. Misty's built-in agent lives in the personal Space. An agent can be
  moved to another Space later; its past artifacts stay where they were saved.
- **Agents are members.** A Space's member list shows people and agents, and
  says whose each agent is. People can invite others to their personal Space
  like any Space.
- **Artifacts save to the agent's Space automatically.** Files, images, code
  outputs, documents and downloads from agent work become Space items. They
  count against the agent owner's storage. This replaces today's local-only
  tracking in `src/features/agents/taskArtifacts.ts`, which lives in
  localStorage on one computer.
- **Code projects stay local folders,** linked to the Space. The sandbox and git
  work as today. The Space shows the project and keeps its outputs and
  snapshots as artifacts.

### Agents page vs Space
- **Agents page:** your private one-to-one conversations with your agents. Work
  happens here, and nobody else sees these chats.
- **Space:** the shared place, with its members (people and agents), the
  artifacts agents saved, notes and tasks, and the Space chat.

### Talking to other people's agents
- In a Space chat, anyone can @mention any agent that's a member, including a
  teammate's.
- The request runs under the owner's rules, which reuse `space_agent_listings`
  (accept policy ask / auto / off, max open requests). The agent only uses what's
  in the Space unless its owner approves more.
- The reply posts in the Space chat. Requests are billed to the person who asked,
  as `agent_member_requests` already does.
- People can't open or read another person's conversations with their agent, or
  message it privately.
- Agent-to-agent work continues for longer jobs (`agentCollaboration.ts`). Each
  owner sees their own agent's side of the exchange in full.
- A request from another agent is untrusted input: it can never make the
  receiving agent reveal its owner's private apps, files or chats.

### Data changes
- Agents (`misty_ask_identities`) get a required `space_id` (backfilled to the
  personal Space).
- Space membership gets an agent member kind with an owner.
- Agent artifacts become Space items with provenance (agent, conversation, run).
- `space_agent_listings` defaults to "ask" for every agent member.

### Verification
- Migration test: every existing agent ends up in its owner's personal Space.
- Visibility rules across two accounts: artifacts are visible, chats are not, and
  there's no direct message to another person's agent.
- @mention requests are billed to the requester and respect off/ask/auto.
- An artifact saved on one computer shows up on another.

### Built (2026-10-12, uncommitted)
Migration `20271012020000_agents_in_spaces`, contract tests in
`server/test/contract/postgres/agents_in_spaces_test.go`.
- **Personal Space:** `misty_ensure_personal_space` creates "<First name>'s
  Space" at sign-up (trigger on `users`) and for existing accounts. Accounts
  that already had a default Space keep it under its name. Created Spaces are
  never the default any more.
- **One Space per agent:** `misty_ask_identities.space_id`, required for live
  agents. A trigger defaults new agents to the personal Space and refuses a
  Space the owner isn't in. Misty's built-in agent can't move.
- **Membership is the listing:** each agent has exactly one
  `space_agent_listings` row, in its Space, kept by a trigger. A move starts over
  at "ask". "Off" replaces unpublishing. When the owner leaves a Space or it's
  deleted, its agents go back to the owner's personal Space.
- **@mentions:** a Space chat message that mentions an agent member starts a
  member request (`requester_run_id` = `message:<id>`). It runs under the
  owner's off/ask/auto rule. The owner's own mentions never wait. The reply,
  "waiting for approval", "declined" and "not taking requests" all post under
  the message as the agent. Mentions in a group chat need the owner in it.
- **Billing changed:** all member requests, agent-to-agent included, now bill
  the person who asked (`space_runs.billing_user_id`); before, the owner paid.
- **Artifacts:** uploads can carry agent provenance (agent, conversation, run,
  kind). The agent must live in the target Space, and finished items get a
  `space_agent_artifacts` row. Downloads from agent work save automatically.
  After a run changes a code project, a ZIP snapshot saves too. The snapshot
  leaves out `.git`, package and build folders and `.env` files, and stops at
  100 MB. Only the owner sees the conversation and run ids. The Space overview
  credits these files to the agent ("Researcher, Bob's agent") and has a
  "From agents" filter. localStorage tracking in `taskArtifacts.ts` is gone.
- **UI:** a Space picker on agent setup and the editor. "Requests from the
  Space" (ask/auto/off) replaces the old per-Space sharing. An Agents section
  sits under Members. Agent members show in the chat's @ list.
- **Also:** the rail's Team popover lists agent members under the people, and the
  account export gives each agent its `space_id` and its membership there.
- **Storage:** every agent artifact, agent chat message and agent-made note is
  stored as the agent's owner, so it counts against the owner's plan (5 GB to
  2 TB), even when another member asked for the work. Only the AI cost moves to
  the asker.

---

## 2. Workflow parity: C1, C2, C8
These close the gaps that stop Misty from claiming "does what Muse, Dots and
Grok Bot do". The IDs come from `ai-browser-comparison.md`.

- **C1 Scheduled tasks that drive the browser.**
  - Schedules can pick a computer and run browser work there while Misty is open
    and the computer is awake (keep-awake already exists).
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
[docs/design/voice-memory/BRIEF.md](../design/voice-memory/BRIEF.md) (revision 1,
with mockups). The work happens on `voice-memory/audeeo-soniox`, which builds on
the agent permissions branch (`agents/permissions-coding-clis`).

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
6. Cursor agent upgrades, and Windows parity rows in
   [windows-parity-ledger.md](windows-parity-ledger.md).

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
