# AI Everywhere in Misty

**Product and implementation report**  
**Prepared:** August 21, 2026  
**Scope:** Current Misty desktop/web product, server-side Agent Toolbox, and established AI interaction patterns in adjacent products.

## Executive conclusion

The idea is sound, and it fits Misty unusually well.

Misty should continue to treat **Agents** as a first-class destination for creating, configuring, inspecting, and holding longer conversations with agents. But Agents should not only be a destination. Agent capabilities should also feel native throughout Misty, invoked from the object, selection, pane, or workflow where the user is already working.

The product already has much of the hard backend foundation:

- a permission-aware Agent Toolbox with typed input/output schemas;
- explicit risk levels, approvals, audit events, locality, and source/trigger restrictions;
- tools for tasks, notes, calendar, roadmaps, Library metadata, Space messages, provider integrations, browser tabs, local file inspection, and agent delegation;
- durable agent sessions, activity, model selection, usage metering, rate/cost ceilings, MCP support, and run-bound browser grants;
- a split-pane workspace that can keep collaborative Space context beside private execution tools.

The largest gap is the **product integration layer** between those capabilities and each Misty surface. Today, much of the toolbox is exposed mainly through chat. Global Misty already combines Search, Ask, and Action, but its Ask flow receives context labels rather than resolved object contents, and its Action flow initially labels risk from the first verb in the prompt. Code has a good selection-based rewrite interaction, and Smart Library has meaningful AI analysis, but these are isolated implementations rather than parts of one system.

The recommended strategy is:

1. Build one shared **AI Surface SDK** in the client.
2. Build one server-side **Context Broker** that resolves references with current permissions.
3. Route all mutations through the existing typed Agent Toolbox and a consistent proposal/approval UI.
4. Add surface adapters and missing domain tools in priority order.
5. Introduce proactive AI only after explicit, contextual invocation is reliable and trusted.

The first release should focus on four high-frequency loops:

- Notes: selection actions, page summary, action-item extraction, and contextual drawer.
- Planner: draft/break down work, summarize status, identify risks, and create reviewed task proposals.
- Browser: page/selection Q&A, summaries, comparison, and clearly scoped agent actions.
- Global Misty: permission-aware answers with citations and actions that can continue in the relevant pane.

Inbox should follow immediately because email-to-task, email-to-calendar, thread summary, and reply drafting connect several existing Misty tools into one coherent workflow.

## 1. What Misty has today

This inventory is based on the current working tree, not only the top-level navigation.

### 1.1 Product surfaces

Misty’s dock registry defines these primary surfaces: Home, Inbox, Space, Browser, Terminal, Code, Files, Transfers, Agents, and Extensions. A Space contains several additional tools:

- Journal: Notes and Drawings
- Planner: Tasks (board and list), Agenda (month/week/day), Goals, Milestones, and Roadmaps
- Chat
- Library
- Members, connections, suggestions, and Space settings

There are also cross-surface capabilities that function as tools in their own right:

- Global Search / Ask / Action
- Activity and attention items
- multi-pane, multi-tab workspace navigation
- image preview and photo editing
- connected devices and remote providers
- Gmail/Outlook inbox connections
- Google Calendar, Notion, Slack, Discord, Figma, and GitHub integrations
- plugin/extension discovery and execution
- transfers between storage locations

### 1.2 Existing AI and agent capabilities

| Area             | What is already implemented                                                                                                                                           | Main limitation                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Personal Agents  | Custom agents, model choice, Space selection, durable conversations, voice input/output, attachments, activity, inline approvals, MCP connections, browser attachment | Mostly experienced as a dedicated chat surface                                                           |
| Space agent runs | Permission-aware server tools, run state, approvals, audit events, provider tools, delegation                                                                         | Surface context is not uniformly passed from every tool                                                  |
| Global Misty     | Compact launcher plus expanded Search / Ask / Action UI, conversations, context chips, action proposals                                                               | Ask receives metadata labels, not authoritative hydrated content; citations are currently empty          |
| Global Search    | Searches Spaces, tasks, notes, drawings, roadmaps, calendar, conversations, Library records, local files, agents, workflows, and activity                             | Mostly lexical/ranked retrieval; semantic retrieval is not generalized beyond Library/media paths        |
| Code             | Selection-based streaming rewrite with preview and Apply; BYOK model/provider settings                                                                                | Separate AI stack from hosted agents; no repo-scale agent, completions, test loop, or shared audit model |
| Smart Library    | Vision metadata, captions, tags, semantic embeddings, hybrid search, usage limits, opt-in controls                                                                    | Intelligence is concentrated on Library assets rather than reusable across Misty content                 |
| Browser          | Run-bound tab grants for inspect, navigate, click, and downloads; automatic expiry and revocation                                                                     | No persistent contextual side drawer or selection-level Q&A in the browser surface                       |
| Files            | Agent scopes for browse/search/preview, validate plans, and apply approved move/rename/mkdir plans                                                                    | Invocation is not embedded in file selection/context menus; content support is uneven                    |
| Notes            | Collaborative BlockNote editor, Markdown projection, Notion/native connectors, note search/read/create/update agent tools                                             | No inline AI selection menu, slash actions, page summary, or AI block                                    |
| Planner          | Rich task, calendar, goal, milestone, and roadmap UI; task/calendar/roadmap agent tools                                                                               | Agent can only create/update a subset of planning structure; no embedded planning copilot                |
| Inbox            | Unified Gmail/Outlook reading, compose, draft/send, archive/read/star actions                                                                                         | No mail tools in Agent Toolbox and no summarization, drafting, extraction, or triage AI                  |
| Drawings         | Collaborative Excalidraw-like surface and Figma bindings                                                                                                              | No drawing-read or drawing-mutation agent tools; no selection intelligence                               |

### 1.3 Important architectural strengths to preserve

Misty’s current product principles are the right ones for pervasive AI:

- Collaborative Space data and private execution tools are separate by default.
- Local file paths are stripped from global AI requests.
- Browser access is attached to a run, scoped to an opaque tab reference, revocable, visible, and expiring.
- Tool descriptors include risk, locality, permissions, approval policy, idempotency, audit event, source, and trigger.
- Write tools use structured schemas rather than free-form commands.
- The server rechecks Space permissions instead of trusting client-provided Space identity.
- Provider calls have concurrency, request, token, and daily/hourly circuit breakers.
- Remote MCP endpoints have fixed HTTPS boundaries, DNS/IP checks, request/response limits, and no redirects.

These are differentiators. “AI everywhere” should extend them, not create shortcuts around them.

## 2. What the market has converged on

The strongest products do not use one invocation pattern. They combine several patterns based on the user’s location and intent.

### 2.1 Repeated interaction patterns

| Pattern                 | Where it appears                                     | Why it works                                                                                         |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Selection menu          | Document editors, design canvases, code editors      | The selection supplies exact scope, so the user writes a shorter prompt and gets a reversible result |
| Contextual side drawer  | Browser, docs, mail, project tools                   | Preserves the primary artifact while supporting longer questions and follow-ups                      |
| Inline generation       | Blank line, task field, code cursor, reply composer  | Keeps generation at the point of insertion and makes Apply/Discard obvious                           |
| Object action           | Task card, message, file, calendar event             | Converts a generic assistant into a domain-specific command with known inputs                        |
| Global search-to-answer | Work search products and chat tools                  | Lets one query retrieve objects, synthesize an answer, and link to sources                           |
| Draft proposal          | Plans, task sets, calendar events, external messages | Allows review before committing multiple writes                                                      |
| Proactive suggestion    | Terminal failures, overdue work, inbox triage        | Useful when confidence is high and the suggestion is dismissible and inexpensive                     |
| Background delegation   | Coding agents, research, recurring status work       | Appropriate for long-running tasks with status, notifications, artifacts, and review                 |

Official product documentation shows this convergence:

- Notion places AI in the text selection menu, slash/block menus, page context, databases, workspace search, and a broader agent. Its selection skills include improve, proofread, explain, and reformat; skills are reusable contextual actions rather than only prompts in chat. ([Notion Skills](https://www.notion.com/help/create-and-manage-skills), [Notion AI overview](https://www.notion.com/help/notion-ai-faqs))
- Google Docs uses a top-right side panel, selected-text context, page summaries, insertion, retry, and feedback. ([Gemini in Docs](https://support.google.com/docs/answer/14206696))
- Microsoft Planner can generate buckets, goals, and tasks, then lets users review and revise the result; newer Planner Agent experiences use editable task cards and review before creation. ([Create a plan with Copilot](https://support.microsoft.com/en-US/Planner/copilot/create-a-new-plan-with-copilot-in-planner-preview), [Planner Agent](https://support.microsoft.com/en-us/Planner/what-can-you-do-with-planner-agent-in-copilot))
- Linear exposes its agent in a dedicated chat, a global shortcut, and inline `@Linear` mentions in comments. It can create/update planning objects and summarize work or blockers. ([Linear Agent](https://linear.app/docs/linear-agent))
- Slack combines thread/channel summaries, recaps, natural-language search filters, grounded answers with source links, file summaries, message explanation, and workflow generation. ([Slack AI guide](https://slack.com/help/articles/25076892548883-Guide-to-AI-features-in-Slack))
- Gmail combines top-of-thread summaries, a side panel, reply suggestions, drafting, search across mail/Drive, event creation, and task extraction. ([Gemini in Gmail](https://support.google.com/mail/answer/14355636))
- Edge and ChatGPT Atlas use a top-right browser side panel that sees the current page; the assistant can summarize/explain/extract, while an explicit agent mode performs browser actions. ([Copilot in Edge](https://support.microsoft.com/en-us/microsoft-copilot/getting-started-with-copilot-in-microsoft-edge), [Ask ChatGPT and Agent in Atlas](https://help.openai.com/en/articles/12628199))
- Warp attaches AI to terminal blocks, provides prompt suggestions after errors, predicts the next command, proposes code diffs, and allows an agent to take or return control of an interactive terminal. ([Warp Active AI](https://docs.warp.dev/agent-platform/local-agents/active-ai), [Full terminal use](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use))
- GitHub Copilot spans cursor-level suggestions, inline chat, repository chat, code review, background agents, custom instructions, and automated repository workflows with declared permissions and safe outputs. ([Copilot concepts](https://docs.github.com/en/copilot/concepts), [Agentic workflows](https://docs.github.com/en/copilot/concepts/agents/about-github-agentic-workflows))
- Miro runs AI on selected board objects to generate, cluster, summarize, and turn sticky notes into documents; it also generates diagrams from prompts and selected content. ([Miro AI with sticky notes](https://help.miro.com/hc/en-us/articles/28781881506834-Miro-AI-with-Sticky-notes), [Miro Diagrams](https://help.miro.com/hc/en-us/articles/25275263961874-Miro-Diagrams))
- Figma applies AI to selected design objects for contextual layer renaming, content replacement, asset search, and interaction generation. ([Figma AI tools](https://help.figma.com/hc/en-us/articles/23870272542231-Use-AI-tools-in-Figma-Design))
- Dropbox Dash separates fast search from deeper chat, supports attached sources, and retrieves across connected tools while preserving source permissions. ([Search vs. Chat](https://help.dropbox.com/view-edit/dash-search-vs-chat), [Search and explore](https://help.dropbox.com/view-edit/dropbox-dash-search-and-explore))
- Motion creates tasks from chat, documents, email, and meeting notes, then schedules them based on workload, deadline, duration, and availability. It emphasizes reviewing extracted task suggestions. ([Motion tasks](https://www.usemotion.com/help/project-management/task), [Auto-scheduling](https://www.usemotion.com/help/time-management/auto-scheduling))

### 2.2 The lesson for Misty

The dominant pattern is not “put a chatbot in every app.” It is:

> Give the user the smallest useful AI control at the point where context is already unambiguous, and let that control expand into a conversation or delegated run only when the work requires it.

This suggests three levels of AI in Misty:

1. **Quick transform** — one object or selection, immediate preview, Apply/Discard.
2. **Contextual copilot** — side drawer grounded in the active pane, with follow-up conversation and structured proposals.
3. **Delegated agent** — asynchronous, multi-step work with an explicit capability grant, progress, approvals, artifacts, and audit history.

The same request may move between levels. A user can select messy meeting notes, choose “Extract tasks,” review five task cards, then delegate research for one task to an agent.

## 3. Recommended product model

### 3.1 One agent, many entry points

Every supported surface should expose a consistent Misty glyph in its top-right toolbar when space permits. Activating it opens a side drawer inside that pane, not a global overlay over the whole workspace. The drawer automatically attaches the active surface and visible object as context and says so plainly.

Additional entry points should be used where they are natural:

- text selection menu in Notes, email, browser text, task descriptions, and Code;
- canvas selection menu in Drawings and Roadmaps;
- row/card context menu in Tasks, Files, Library, Inbox, Transfers, and Extensions;
- blank-state or blank-line generation in Notes, Planner, Roadmaps, and Drawings;
- `@agent` mention in Space chat and comments;
- keyboard shortcut that opens the drawer for the focused pane;
- Global Misty for queries that do not start from one surface;
- proactive, dismissible suggestion chips for high-confidence events such as a failed terminal command or an overdue cluster of tasks.

### 3.2 Consistent user contract

Every invocation should answer four questions in the UI:

1. **What does the agent see?** Context chips show the page, selection, task, files, or Space records included.
2. **What can it do?** The surface determines a narrow initial capability set. More capability requires an explicit attachment or grant.
3. **What will change?** Writes are rendered as domain-native previews: a text diff, task cards, calendar cards, file plan, roadmap patch, browser step, or message draft.
4. **How can I recover?** Use Apply/Discard for transforms, Confirm/Cancel for proposals, Undo where the domain supports it, and a durable audit/activity entry for delegated work.

### 3.3 Keep “Misty” and custom agents distinct

Use **Misty** as the built-in contextual copilot. It is optimized for the active surface and uses the user’s current permissions. Let users optionally hand work to a named custom agent when specialization or asynchronous work matters.

The UI should not force agent selection for routine actions. “Summarize this note” should work immediately with Misty. “Have Researcher compare these sources and draft a recommendation by tomorrow” is a delegation moment.

## 4. Surface-by-surface opportunity map

The recommendations below include quick wins, deeper agent behavior, and required backend support.

### 4.1 Home

**Best role for AI:** orientation and intent routing.

Recommended experiences:

- “Brief me” card summarizing today’s meetings, due/overdue tasks, important activity, and active agent work, with citations to each source.
- Suggested next actions such as “Resolve three overdue tasks,” “Prepare for the 2 PM review,” or “Reply to the launch thread.”
- Natural-language capture that determines whether input is a search, question, task, note, event, URL, path, or delegated request.
- End-of-day recap with completed work, slipped work, decisions, and a proposed tomorrow plan.

Implementation notes:

- Extend the current Home command parser with a server-side intent router only after deterministic URL/path/command handling.
- Keep suggestions derived from visible records and never auto-create work.
- Reuse the Global Misty drawer and citation cards rather than creating a Home-only chat.

### 4.2 Global Search / Ask / Action

**Best role for AI:** the universal entry point and cross-tool context assembler.

Recommended experiences:

- Preserve instant lexical search as the first response; add semantic and permission-aware retrieval in parallel.
- When input is a question, show a grounded answer above results with source chips and links.
- Let users select multiple results and choose Ask, Compare, Summarize, or Act.
- Support commands such as “turn these notes into a plan,” “show blockers for launch,” or “find the file Sarah sent and open it beside the roadmap.”
- Continue an answer in a pane-level drawer without losing context.
- Make Search, Ask, and Action progressive rather than three isolated modes: a search result can become context; an answer can become a proposal; a proposal can become an agent run.

Backend gap:

- The current Ask endpoint formats context as labels and explicitly says not to imply content was read. Add server-side reference hydration, permission rechecks, retrieval, and citations.
- Replace first-verb risk labeling with tool-derived risk after planning. The model may propose tools, but deterministic policy assigns risk and approval.
- Generalize the existing pgvector/embedding infrastructure from Smart Library into a permission-filtered cross-domain retrieval service.

### 4.3 Activity and notifications

**Best role for AI:** attention compression.

Recommended experiences:

- “Catch me up” over unread activity, grouped by Space and outcome rather than raw event count.
- Collapse repeated changes into one narrative: what changed, why it matters, and what needs the user.
- Suggested actions directly on recap items: acknowledge, open, reply, update task, or dismiss.
- Explain “Why this is important” using the underlying activity and current deadlines.

Avoid silently reprioritizing or hiding notifications. AI ranking should be a view layered over the complete activity stream.

### 4.4 Space Chat

**Best role for AI:** conversation compression and conversion into durable work.

Recommended experiences:

- Summarize unread messages, a selected range, or one thread with source links.
- Extract decisions, questions, owners, dates, and action items into reviewable cards.
- Convert a message or selection into a task, note, calendar event, Library item, or roadmap idea.
- Draft a reply based on the current conversation and optionally attached Space records.
- Mention a named agent inline; show its plan/progress in the thread and keep detailed activity in the drawer.
- Scheduled daily/weekly Space recap posted only after an owner configures it.

Backend work:

- Existing message search/send tools are a strong base. Add conversation-range read and structured summary/extraction operations.
- Keep external/provider content classified as untrusted input. Citations should link to message IDs.

### 4.5 Planner: tasks

**Best role for AI:** turn intent into a realistic, reviewable plan.

Recommended experiences:

- Top-right Planner drawer automatically scoped to the Space, filters, and visible view.
- “Plan this” from a short brief, note, email, file, or selected messages. Return editable task cards before creation.
- Task-level actions: improve title, rewrite acceptance criteria, break into subtasks, estimate effort, suggest priority, identify dependencies, find duplicates, and draft a status update.
- Board-level actions: summarize progress, identify blockers/stale work, suggest assignments based on declared roles/workload, and draft the next sprint/week.
- Bulk action from selected cards with a full before/after preview.
- “Why is this at risk?” explanation using dates, dependencies, workload, and recent activity.

Backend work:

- Extend task schemas to include duration/effort, dependencies, labels, subtasks, and structured acceptance criteria if those become first-class fields.
- Add batch proposal endpoints rather than invoking `tasks.create` repeatedly without an aggregate preview.
- Use stable member resolution and never guess an ambiguous assignee.

### 4.6 Agenda and Calendar

**Best role for AI:** translate commitments into time and expose schedule conflicts.

Recommended experiences:

- Natural-language event creation in the Agenda and from any selected text.
- Extract event details from chat, notes, email, webpages, and files; show a calendar card for confirmation.
- Suggest meeting times based on required attendees, working hours, and conflicts.
- “Plan my day/week” view that proposes focus blocks for flexible tasks without modifying the calendar until accepted.
- Detect tasks that cannot fit before their deadlines and explain which constraint is responsible.
- After a reschedule, offer to update affected tasks or notify collaborators with a reviewed draft.

Research supports the value of suggested meeting times and adaptive task scheduling, but Misty should begin with proposals rather than automatic rearrangement. Google Calendar surfaces suggested times, while Motion continuously reschedules flexible work based on deadlines and availability. ([Google Calendar suggested times](https://support.google.com/calendar/answer/16690875), [Motion AI Agenda](https://www.usemotion.com/help/time-management/ai-agenda/ai-agenda-how-to-guide))

### 4.7 Goals, milestones, and roadmaps

**Best role for AI:** structure, scenario analysis, and narrative status.

Recommended experiences:

- Generate a draft roadmap graph from a brief or selected notes, including milestones, goals, risks, dependencies, and open questions.
- Convert a task cluster into a milestone or link existing tasks to a goal.
- Summarize progress toward a goal with evidence from tasks, events, messages, and Library artifacts.
- Detect orphan goals, unowned risks, circular dependencies, and dates that conflict.
- “What if this slips two weeks?” scenario view that highlights downstream impact without changing the live graph.
- Selection actions on nodes: explain, expand, turn into tasks, suggest dependencies, or draft status.

Backend gap:

- Current roadmap agent tools operate mainly at roadmap metadata level. Add typed tools for nodes, edges, goals, milestones, task links, layout suggestions, and batch graph patches with graph-version conflict handling.

### 4.8 Notes

**Best role for AI:** immediate selection transforms plus page-level understanding.

Recommended experiences:

- Selection bubble with concise defaults: Improve, Shorten, Change tone, Summarize, Explain, Translate, Extract tasks, and Ask Misty.
- Slash menu on a populated block for the same actions; blank-line prompt for drafting.
- Page toolbar actions: summary, outline, action items, title/tags, convert to task plan, and ask about this note.
- AI block that can be refreshed from explicitly selected sources, useful for living summaries/status sections.
- Compare this note with another note/file and insert a cited synthesis.
- Meeting-note mode that extracts decisions and proposes tasks/events after the meeting.
- Reusable team “skills” such as “Turn into PRD,” “Client-ready recap,” or “Research synthesis.”

Frontend work:

- Integrate with BlockNote selection and block menus.
- Render a streaming suggestion adjacent to the selection with Replace, Insert below, Retry, and Discard.
- In collaborative notes, AI output should be attributed as an agent-authored edit and applied as one transaction for clean undo/history.

Backend work:

- Existing note search/read/create/update tools are enough for page-level chat and whole-note writes.
- Add a patch/range operation so inline edits do not replace the entire Markdown projection and accidentally overwrite concurrent work.

### 4.9 Drawings

**Best role for AI:** organize visual thinking and turn it into structured work.

Recommended experiences:

- Selection menu for cluster by theme/sentiment, summarize, name groups, generate a note, extract tasks, and create a diagram from selected objects.
- Prompt-to-sticky-notes, prompt-to-flowchart, and selected-content-to-mind-map.
- Smart cleanup: alignment, labels, connectors, and conversion of rough shapes into structured shapes.
- OCR or “digitize this sketch” for imported images.
- Generate alt text and a textual board outline for accessibility and search.
- Ask questions about the selected frame rather than the entire infinite canvas.

Backend gap:

- Add drawing snapshot/read tools and a versioned drawing patch format. Do not give a model unrestricted access to the raw collaborative document.
- Convert model output into a constrained scene-operation schema, validate bounds/types, preview the result, then apply it as one undoable transaction.

### 4.10 Library and media search

**Best role for AI:** understanding, retrieval, organization, and reuse.

Recommended experiences:

- Keep Smart Library’s opt-in analysis, generated captions/tags, and semantic search.
- Add “Ask about selection” for one or several Library items with citations to file/page/slide/timecode.
- Generate concise summaries and extract entities, dates, tasks, and related Spaces.
- Related-items and “used together” suggestions.
- Duplicate/near-duplicate review, best-version suggestion, and safe archive plan.
- OCR/transcription visibility with a way to correct generated metadata.
- Convert selected material into a note, task plan, presentation brief, or chat attachment.
- Video/audio scene search and highlight/reel proposals based on existing time-coded indexing.

Backend work:

- Reuse the current Library embeddings and media segments as the first implementation of the Context Broker.
- Preserve user-authored metadata separately from generated metadata so reanalysis never overwrites deliberate edits.
- Store model/version/input hash and allow regeneration or deletion when AI is disabled.

### 4.11 Inbox

**Best role for AI:** summarize, draft, extract, and triage.

Recommended experiences:

- Summary at the top of a long thread: status, requests, dates, commitments, and unanswered questions.
- Reply composer actions: draft, shorten, adjust tone, answer all questions, and use attached Misty context.
- One-click reviewed proposals to create tasks, calendar events, Notes, or Library entries from an email.
- Inbox recap grouped by urgency/project/person, with reasons and direct links.
- Ask across mail: “What did the client decide about pricing?” with cited messages.
- Suggested archive/star/read actions, always as a reviewable batch.

Backend gap:

- Add mail read/search/thread, draft, and send tools. Separate `mail.draft` from `mail.send`; sending is consequential and should always show recipients, subject, and final body for confirmation.
- Email bodies and attachments are untrusted content and must not directly instruct tool use.

### 4.12 Browser

**Best role for AI:** contextual understanding and bounded action in the user’s signed-in session.

Recommended experiences:

- Top-right icon opens a pane-local drawer attached to the current tab.
- Default actions: summarize page, explain selection, extract table/data, compare with another attached tab, cite claims, and save findings to a Note or Library.
- Text-selection bubble for Ask, Explain, Summarize, Translate, and Add to context.
- Research session that groups sources, maintains citations, and produces a reusable note.
- Explicit switch from “Ask about page” to “Act in tab.” Show the run-bound grant, its expiry, current action, and Take over/Stop controls.
- Before a sensitive click or submission, show the exact target and effect.

Backend/security work:

- Keep the existing inspect/navigate/click/download capability set and run-bound opaque scope IDs.
- Add form fill, tab list/switch, screenshot, and controlled download only as separate capabilities.
- Treat page text as data, never instructions. Use action screening against the original user request before browser writes.

### 4.13 Files

**Best role for AI:** understand content and propose organization without leaking device data.

Recommended experiences:

- File/folder selection menu: summarize, ask, rename suggestions, organize, find duplicates, convert, extract text, or add to a Space.
- Folder drawer that can answer “what is in here?” from a bounded index and preview supported documents.
- Natural-language semantic search across filenames, extracted text, image captions, and media transcripts.
- Cleanup plan with grouped rationale, confidence, conflicts, and a before/after tree.
- Explain an unknown file, recommend an app/extension, or preview likely contents without opening when supported.

Backend work:

- Existing list/search/preview/validate/apply file-plan tools are a strong base.
- Add explicit copy, archive, trash, duplicate resolution, conversion, and checksum tools only when their recovery semantics are clear.
- Keep local work device-executed with opaque scopes. The server should receive extracted/attached content only after explicit user action.

### 4.14 Code

**Best role for AI:** span cursor assistance, selected edits, repository reasoning, and delegated implementation.

Recommended experiences:

- Keep the existing streaming selection rewrite, but move it onto the shared AI surface contract and preview components.
- Add inline completions/predicted edits with a per-user off switch.
- Code-action menu: explain, fix diagnostic, add tests, document, refactor, optimize, and review selected code.
- Repository drawer with `@file`, `@symbol`, diagnostics, git diff, and terminal output attachments.
- Multi-file edit plans rendered as diffs, with per-file accept/reject and test results.
- Background coding agent launched from a task, diagnostic, or request; completion returns a diff/branch/PR artifact for review.
- Project, path, and personal instructions so agents follow repository conventions.

Backend work:

- Unify BYOK inline requests and hosted agent semantics at the UI/telemetry layer even if execution providers remain different.
- Add code read/search/symbol/diagnostic tools, patch application, test execution, and git tools with sandbox and approval policies.
- Treat dependency installation, pushing, publishing, and unsandboxed execution as higher-risk capabilities.

### 4.15 Terminal

**Best role for AI:** explain failures, suggest safe next steps, and optionally operate the live session.

Recommended experiences:

- Select or attach a terminal block and choose Explain, Fix, Summarize, or Ask Misty.
- After a non-zero exit, show one dismissible suggestion such as “Explain failure” or a proposed command.
- Next-command ghost text that inserts into the input buffer but never executes on acceptance alone.
- Agent mode attached to the current PTY with a visible control state: observing, proposing, running, waiting, or stopped.
- Per-command approval, “allow similar for this session,” Stop, and Take over.
- Secret redaction before model context, plus a preview of what terminal output will be shared.

Backend/native gap:

- Define `terminal.observe`, `terminal.propose`, and `terminal.write` separately. Do not expose an unrestricted shell tool under a generic write permission.
- Scope grants to one PTY/session and expire them with the run.

### 4.16 Transfers

**Best role for AI:** diagnosis and policy suggestions, not routine transfer execution.

Recommended experiences:

- Explain a stalled/failed transfer in plain language and recommend recovery.
- Group repeated failures by root cause.
- Suggest conflict policy for a reviewed batch: overwrite, keep both, skip, or rename.
- Summarize transfer status and verify completeness/checksum evidence.
- Create a support bundle or issue draft from selected failures.

Keep AI quiet during healthy transfers. This surface benefits more from good deterministic status and recovery than from a permanent chat panel.

### 4.17 Extensions

**Best role for AI:** intent-based discovery and permission explanation.

Recommended experiences:

- Search by outcome: “compress these images,” “download this video,” or “back up this folder.”
- Recommend an installed or catalog extension based on selected file type and current task.
- Explain requested permissions and where the extension will appear in plain language.
- Build a reviewable multi-extension workflow when outputs/inputs are compatible.
- Help extension authors draft manifests, descriptions, and test cases in a developer mode.

Installation, enabling, and permission expansion remain explicit user actions. Recommendations should explain why a plugin matches and whether it is verified.

#### Bundled extension scan

The current published catalog contains six extensions. AI should enhance their intent, explanation, and review layers; deterministic media, backup, and storage engines should continue to perform the actual work.

| Extension       | Useful AI integration                                                                                                                             | Required guardrail                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage Report  | Explain where space is going, group unusual growth, propose a cleanup plan, and answer questions over the completed read-only scan                | AI receives the bounded report, not unrestricted filesystem access; deletion remains a separate Files proposal                                       |
| Image Optimizer | Recommend format, quality, and dimensions for a stated destination; explain visual/file-size tradeoffs; add caption/alt-text generation           | Show estimated output and preserve originals; the model never constructs a shell command                                                             |
| Backups         | Recommend source sets and cadence, explain failed verification, summarize snapshot coverage, and create a reviewed restore plan                   | Repository credentials remain in the OS vault; restore always targets a new collision-safe folder; AI cannot weaken encryption or retention silently |
| Quick Convert   | Translate intent such as “make this small enough for email” into supported format/quality settings and explain compatibility                      | Conversion uses the pinned FFmpeg tool and typed options; output stays collision-safe and source-preserving                                          |
| Themes          | Generate an accessible palette from a prompt/reference, explain token roles, and check contrast before preview                                    | Apply remains explicit and reversible; reject inaccessible combinations or label their contrast failures                                             |
| yt-dlp          | Interpret the desired media/audio format, summarize inspected playlist scope, and optionally transcribe/chapter downloaded media after completion | Respect site rights/terms; retain playlist bounds, destination preview, cancellability, and pinned command arguments                                 |

The non-catalog Vault and Preview Panel source files appear to be prototype/development surfaces rather than registered published extensions. If Vault is revived separately from Backups, consolidate them first so AI does not expose two overlapping backup concepts. Preview Panel should use AI only as a developer aid for generating test scenes or accessibility checks, not as a user-facing agent surface.

### 4.18 Photo editor and media editing

**Best role for AI:** selection-based generative editing and accessibility.

Recommended experiences:

- Background removal/replacement, generative fill on a brushed selection, object removal, and canvas expansion.
- Auto-crop variants for common destinations.
- Caption, alt-text, palette, and tag generation.
- “Match this style” using an explicitly attached reference.
- Always generate a new version or copy by default; preserve the original and provenance.

Adobe’s generative-fill pattern is appropriate: the user paints the exact region, enters a prompt, reviews variants, and applies the chosen result. ([Adobe Firefly generative fill](https://helpx.adobe.com/firefly/web/work-with-images/edit-images/generative-fill.html))

### 4.19 Agents

**Best role for AI:** configuration, delegation, oversight, and learning reusable behavior.

Recommended experiences:

- Keep create/edit, model, Spaces, tool policy, MCP, conversation, and activity functions.
- Add starter templates by job rather than model: project coordinator, researcher, librarian, inbox assistant, coding agent.
- Offer permission presets with plain-language differences and a full advanced tool list.
- Let a user save a successful contextual action as a reusable Skill.
- Show which surfaces can invoke each agent and let the user opt agents into inline menus.
- Unified run inbox with active/waiting/completed/failed states across all surfaces.
- Replayable audit view: input context labels, tool requests, approvals, results, artifacts, cost, and source links.

### 4.20 Settings, integrations, and the workspace

**Best role for AI:** transparency and coherent cross-pane context.

Recommended settings:

- Master AI switch plus per-surface switches for inline actions, drawer, proactive suggestions, and indexing.
- Hosted versus BYOK model choices presented as a product policy, not duplicated per feature.
- Context-source controls: current object, Space, connected providers, web, local files, browser, terminal, and personalization/memory.
- Retention controls for conversations, generated summaries, embeddings, and agent memory.
- “What Misty can access” dashboard with active device/browser/PTY grants and immediate revocation.
- Usage and cost view by feature/run, not only by model.

Workspace behavior:

- The drawer belongs to a pane and follows that pane’s active tab.
- A user can pin the drawer or pop it into a neighboring pane for longer work.
- Context can be dragged or added from another visible pane. Moving private context into a shared Space requires an explicit share action.
- The same conversation can follow an object across views, but context does not silently broaden when the user changes panes.

## 5. Target frontend architecture

### 5.1 AI Surface SDK

Create a feature package such as `app/src/features/ai-surface/` with a small registration contract:

```ts
interface AiSurfaceAdapter {
  surfaceId: string;
  getContext(): AiContextReference[];
  getSelection?(): AiSelection | null;
  getSuggestedActions?(): AiSuggestedAction[];
  handleArtifact?(artifact: AiArtifact): Promise<void>;
  canApply?(artifact: AiArtifact): boolean;
}
```

Every surface supplies identifiers and display metadata, not arbitrary serialized state. The server resolves server-owned references; native/device bridges resolve opaque local references. Adapters also understand how to render/apply domain artifacts.

### 5.2 Shared components

Build once and reuse:

- `AiSurfaceButton` — toolbar entry point with running/attention state.
- `AiDrawer` — conversation, suggested actions, context chips, artifacts, approvals, and run status.
- `AiSelectionMenu` — small menu anchored to text/canvas/object selection.
- `AiInlinePrompt` — prompt at cursor/selection with streaming result.
- `AiContextBar` — visible sources with remove/add controls and privacy state.
- `AiArtifactCard` — renderer switch for text diff, task set, calendar event, file plan, roadmap patch, drawing patch, message/email draft, code diff, terminal command, and browser action.
- `AiApprovalCard` — effect, destination, permission, risk, and confirm/cancel.
- `AiRunIndicator` — queued/running/waiting/completed/failed plus Stop/Open activity.
- `AiFeedbackControls` — useful/not useful, incorrect source, unsafe action, and optional correction.

### 5.3 Shared state

Use one account-scoped store for drawer conversations and one pane-scoped registry for active surface context. Do not make each feature own a hidden conversation implementation.

Suggested state keys:

- drawer open/closed and pane ID;
- active conversation/run;
- current context references and selected agent;
- pending artifacts and approval requests;
- per-surface preference and dismissed proactive suggestions;
- stream/cancellation state.

### 5.4 Artifact-first responses

Chat text alone is insufficient for in-product work. The response protocol should support typed artifacts:

```ts
type AiArtifact =
  | TextPatchArtifact
  | TaskSetArtifact
  | CalendarEventArtifact
  | RoadmapPatchArtifact
  | DrawingPatchArtifact
  | FilePlanArtifact
  | MailDraftArtifact
  | CodePatchArtifact
  | TerminalCommandArtifact
  | BrowserActionArtifact;
```

Each artifact includes source references, target version, proposed operations, risk, required approval, and a stable idempotency key. The target surface owns final rendering and application.

## 6. Target backend architecture

### 6.1 Context Broker

Add a service that accepts references, not trusted content:

```json
{
  "surface": "planner.task",
  "space_id": "...",
  "references": [
    { "kind": "task", "id": "...", "version": 12 },
    { "kind": "note", "id": "..." }
  ],
  "selection": { "kind": "text", "opaque_ref": "..." }
}
```

The broker should:

1. authenticate the user and deployment;
2. resolve every server reference through its owning domain service;
3. recheck current object/Space/provider permissions;
4. resolve local references only through the registered device and opaque scope;
5. classify content as trusted instructions, user input, or untrusted retrieved data;
6. retrieve only the minimum relevant chunks;
7. return citation-ready source records and a content revision hash;
8. log reference types and sizes without logging sensitive contents.

This fixes the largest current limitation in Global Misty while preserving the no-local-path rule.

### 6.2 Hybrid retrieval

Create a shared search document model for tasks, notes, messages, calendar events, roadmap objects, drawings/outlines, Library assets, agent artifacts, provider records, and supported files.

Recommended pipeline:

- domain events update a normalized search document and chunks;
- lexical fields remain available for instant exact retrieval;
- embeddings power semantic candidate retrieval;
- filters enforce account, Space, audience, provider, and object permissions before ranking;
- recency, object type, current surface, explicit attachments, and user query rerank candidates;
- answers cite stable objects and precise locations where available (message, note block, file page/slide/sheet/timecode, task, roadmap node).

Do not use one global vector namespace with permission filtering only after retrieval. Permission scope must constrain candidate retrieval or be encoded in secure partitions/queries.

### 6.3 Invocation and run API

Converge quick transforms, drawer turns, and delegated runs on a shared envelope:

- `POST /ai/invocations` — create a streaming quick/drawer invocation;
- `GET /ai/invocations/{id}/events` — SSE event stream;
- `POST /ai/invocations/{id}/cancel` — cancellation;
- `POST /ai/artifacts/{id}/decision` — accept/reject/refine;
- `POST /ai/runs` — start a durable/delegated run;
- existing run/activity endpoints remain authoritative for long-running work.

Important fields include source surface, trigger, conversation, user intent, explicit context refs, selected agent/model policy, requested outcome, and idempotency key. The server derives available tools.

### 6.4 Tooling changes

Extend the existing `Sources` and `Triggers` model rather than bypassing it. Suggested sources:

- `global_misty`
- `surface_drawer`
- `inline_selection`
- `object_action`
- `proactive_suggestion`
- `scheduled_automation`
- existing `canonical_run`, `space_conversation`, `task_assignment`, and `device_conversation`

Suggested trigger values include `message`, `selection`, `object`, `schedule`, `event`, and `handoff`.

The manifest for an inline note selection should include note patch/create-task operations, not browser, terminal, provider, or member-management tools. Capability expansion occurs only when the user attaches more context or delegates.

### 6.5 Missing domain tools, in priority order

1. Fine-grained note patch/range operation.
2. Batch task proposal/create/update and task dependencies/subtasks.
3. Grounded context-read/citation tools shared across search domains.
4. Mail search/read/draft/send and attachment extraction.
5. Roadmap node/edge/goal/milestone patch tools.
6. Drawing snapshot and constrained scene patch tools.
7. Browser form/screenshot/tab capabilities with separate grants.
8. Code repository read/search/symbol/patch/test/git tools.
9. Terminal observe/propose/write tools with PTY grants and redaction.
10. Transfer diagnose/retry/conflict-policy tools.
11. Extension search/explain/install/execute tools.
12. Image generation/edit/version tools.

### 6.6 Model routing

Use task-class routing rather than one default model everywhere:

- deterministic/no-model path for commands, exact navigation, validation, and simple formatting;
- small low-latency model for classification, titles, tags, short rewrites, and suggestions;
- stronger text/reasoning model for multi-source synthesis, planning, and tool orchestration;
- embedding model for retrieval;
- vision model for images/drawings/pages;
- speech models for transcription/voice;
- specialized code model where beneficial.

Keep provider/model names out of normal surface UI unless the user asks. Settings and agent configuration can expose the advanced choice.

### 6.7 Jobs, idempotency, and concurrency

- Quick transforms may be ephemeral but still receive an invocation ID and cancellation.
- Expensive summaries, indexing, media analysis, research, and delegated work run as durable jobs.
- Every write artifact and tool call carries an idempotency key.
- Optimistic concurrency uses the target object version. Conflicts reopen a refreshed preview instead of silently retrying an outdated patch.
- Reuse the existing provider budget and per-user credit system; add budgets by feature and proactive-job class.

## 7. Safety, privacy, and trust requirements

Pervasive AI increases context exposure and accidental-action risk. The product must be stricter as AI becomes easier to invoke.

### 7.1 Risk model

Use four user-facing classes derived from deterministic tool policy:

| Class         | Examples                                                                             | Default behavior                                                                                            |
| ------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Observe       | Read current note, inspect granted page, search tasks                                | No approval after the user invokes and context is visible                                                   |
| Draft         | Generate text, task set, event, roadmap patch, command                               | Preview; no external or durable effect                                                                      |
| Consequential | Create/update records, send Space message, write provider data                       | Explicit confirm unless the user is applying a visible inline draft to the current object                   |
| Dangerous     | Delete, push/publish, broad browser action, unsandboxed terminal, permission changes | Always confirm with exact target/effect; never covered by blanket approval outside a tightly scoped session |

### 7.2 Prompt-injection boundary

Web pages, email, documents, chat messages, provider responses, MCP tool descriptions, and file contents are untrusted data. They must not change system policy or authorize actions.

Required controls:

- separate instructions, user intent, retrieved content, and tool results structurally;
- allowlist tools per surface/run;
- validate every argument against schema and current permission;
- action-screen proposed writes against the original user intent;
- use a quarantined read/summarization path for high-risk external content where practical;
- never let model output make authorization decisions;
- log tool and guardrail decisions without sensitive raw content;
- adversarial tests for indirect prompt injection on browser, email, document, MCP, and provider paths.

OWASP recommends least privilege, structured validation, human review for high-impact actions, context isolation, monitoring, and separate decision/execution controls for agents. ([OWASP Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html), [Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html))

### 7.3 Trust and explanation

- Show source citations for factual answers and summaries.
- Show what context was used and allow removal before sending.
- Explain recommendations using observable constraints, not invented certainty.
- Display confidence only when it is calibrated for that task; otherwise use concrete caveats.
- Make generated versus user-authored content distinguishable in collaborative history.
- Provide feedback and correction paths tied to the exact invocation/model/tool policy version.

Google’s People + AI guidance emphasizes telling users what data influenced an output, tying explanations to user actions, and increasing explanation/checking as stakes rise. ([PAIR Explainability and Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/)) NIST’s AI RMF provides a broader Govern–Map–Measure–Manage framework for reliability, safety, transparency, privacy, and evaluation. ([NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework))

## 8. Recommended delivery plan

### Phase 0 — shared substrate (2–3 engineering sprints)

Deliver:

- AI Surface SDK and pane-scoped drawer shell;
- common context chips, streaming, artifacts, approvals, cancellation, and feedback components;
- shared invocation envelope and SSE protocol;
- Context Broker for Space objects, beginning with notes/tasks/messages/Library;
- citations and permission-aware retrieval in Global Misty;
- deterministic tool-derived risk labeling;
- telemetry/evaluation harness and feature flags.

Exit criteria:

- one conversation can be opened from Global Misty and from a pane drawer;
- the user can always see/remove context;
- a cited answer never includes an inaccessible Space object;
- a typed proposal can be accepted once without duplicate writes;
- cancellation and approval states survive pane switching.

### Phase 1 — highest-value embedded experiences (3–4 sprints)

Deliver:

- Notes selection menu, inline preview, page summary, and task extraction;
- Planner drawer, plan-to-task-card proposal, task breakdown, and status/risk summary;
- Browser drawer, page/selection Ask, research context, and existing run-bound actions;
- Global Search hybrid retrieval and cited Ask results;
- save successful actions as reusable personal/team shortcuts.

### Phase 2 — connected workflow loops (3–5 sprints)

Deliver:

- Inbox summary, reply drafting, email-to-task/event/note, and mail tools;
- Space Chat recaps and decision/action extraction;
- Agenda time suggestions and reviewed focus-block planning;
- Roadmap graph proposals and scenario analysis;
- Home daily briefing and activity recap.

### Phase 3 — private execution tools (4–6 sprints)

Deliver:

- repository-aware Code drawer, multi-file diffs, tests, and background coding agent;
- Terminal block actions, next-command suggestion, PTY-scoped agent control, and secret redaction;
- Files selection actions, semantic folder search, and improved cleanup proposals;
- richer Library/media Q&A and cross-file synthesis.

### Phase 4 — visual, operational, and proactive intelligence

Deliver:

- Drawing selection intelligence and constrained diagram generation;
- generative photo versions;
- Transfers diagnosis;
- Extensions recommendations and workflow composition;
- opt-in proactive suggestions, recurring recaps, and learned preferences.

Do not start Phase 4 proactive behavior before the product has evidence that users trust the explicit interactions and that permission/citation regressions are controlled.

## 9. Suggested implementation epics

### Epic A — AI surface platform

- Define surface adapter/context/artifact types.
- Add pane-local drawer host to workspace surfaces.
- Build shared selection menu and inline result UI.
- Add shared conversation/run store and account cleanup.
- Add keyboard/focus/accessibility behavior and reduced-motion handling.

### Epic B — grounded context and citations

- Create context-reference registry on server.
- Add resolvers for task, note, message, calendar, roadmap, Library, drawing, and agent artifact.
- Add cross-domain chunk schema and hybrid retrieval.
- Add citation serializer and deep-link validation.
- Add permission revocation and stale-version tests.

### Epic C — artifact and approval protocol

- Define typed artifact schemas.
- Map artifact types to existing/new tool calls.
- Derive risk from tools and targets.
- Implement preview, decision, idempotency, conflict, undo, and audit behavior.
- Add action screening for untrusted-source paths.

### Epic D — Notes and Planner pilot

- BlockNote selection/block integration and transactional patching.
- Planner drawer and visible-filter context.
- Batch task proposal and editable card UI.
- Eval datasets for rewrite fidelity, action extraction, assignment ambiguity, due-date parsing, and duplicate avoidance.

### Epic E — Browser pilot

- Drawer bridge around native webview suspension/geometry.
- Selection/page snapshot attachment.
- Research/citation artifact.
- Visible grant lifecycle and Stop/Take over controls.
- Prompt-injection red-team suite.

### Epic F — measurement and operations

- Invocation spans across retrieval, model, tools, approvals, and artifact apply.
- Cost/latency dashboards by surface and action.
- Curated golden tasks and permission-leak tests.
- User feedback tied to prompt/model/tool versions.
- Rollback switches per surface/action/model.

## 10. Success measures

Measure value at the workflow level, not message count.

### Adoption and usefulness

- percentage of active users invoking AI outside the Agents page;
- accepted/applied artifact rate by surface and action;
- repeat use of the same action within 7/28 days;
- percent of AI sessions started from a selection/object versus global chat;
- successful handoffs from contextual action to delegated agent.

### Efficiency

- time from intent to completed task/event/note/message;
- number of manual field edits after accepting a proposal;
- reduction in navigation between tools for common loops such as email → task → calendar;
- time to recover from terminal/transfer failures;
- time to find and verify information, including citation opens.

### Trust and quality

- citation precision and permission-leak rate (target: zero leaks);
- incorrect-action, duplicate-write, and rollback rates;
- approval acceptance/rejection by risk class;
- undo/revert rate after AI writes;
- prompt-injection test pass rate;
- user-reported incorrect, unsafe, or irrelevant outputs;
- percent of proactive suggestions dismissed or disabled.

### Performance and cost

- time to visible UI response and first streamed token;
- end-to-end duration by task class;
- retrieval/context size and cache hit rate;
- tokens and provider cost per accepted artifact, not per request;
- background-job failure/retry/cancellation rates.

## 11. Product decisions to make before implementation

1. Is the pane drawer always the built-in Misty copilot, with optional delegation, or can a user pin a named agent to a surface?
2. Which AI behaviors are included in the base product versus metered/premium?
3. Should BYOK be available across all quick transforms or remain Code-only initially?
4. What generated outputs are ephemeral, and which are stored as durable collaborative artifacts?
5. What is the retention/deletion policy for embeddings and generated metadata after an owner disables AI?
6. Which user-authored corrections feed ranking/personalization, and are they personal or Space-shared?
7. Can low-risk current-object writes be covered by an “Apply” gesture, while all cross-object/external writes require a separate confirmation?
8. Which proactive triggers are acceptable for the first experiment? Recommended: terminal failure and explicitly requested daily recap only.

## 12. Concrete first implementation slice

The smallest slice that proves the architecture across different object types is:

1. Add an AI drawer button to Notes, Planner, and Browser.
2. Add Notes text-selection actions using a versioned range patch artifact.
3. Add Planner “Create plan” that returns editable task cards and uses one batch approval.
4. Add Browser “Summarize this page” using the existing run-bound tab scope.
5. Upgrade Global Misty to hydrate note/task/message/Library references and return citations.
6. Let any result open or continue in the relevant pane.
7. Instrument apply, reject, retry, undo, citation-open, permission denial, latency, and cost.

This slice demonstrates all three interaction levels—quick transform, contextual copilot, and agent action—while exercising collaborative data, private browser data, citations, version conflicts, approvals, and the split-pane workspace.

## Appendix A — repository anchors

The most relevant current implementation areas are:

- Product principles: `app/PRODUCT.md`
- Route and surface inventory: `app/src/application/routing/routeConfig.tsx`
- Dock surface registry: `app/src/features/workspace/dockRegistry.ts`
- Global navigation: `app/src/application/layouts/DesktopLayout/GlobalNavigator.tsx`
- Global Search / Ask / Action: `app/src/features/global-search/`
- Global Misty server conversations: `server/internal/platform/httpapi/misty_conversations.go`
- Agent Toolbox core: `server/internal/agenttools/registry.go`
- Canonical toolbox composition: `server/internal/platform/httpapi/agent_toolbox_canonical.go`
- Tool catalog and browser descriptors: `server/internal/platform/httpapi/agent_toolbox_catalog.go`
- Notes, Library, calendar, and roadmap tools: `server/internal/platform/httpapi/agent_*_tools.go`
- Device file tools: `server/internal/platform/httpapi/device_agent_toolbox.go`
- Agent risk/approval mapping: `server/internal/platform/httpapi/personal_agent_tool_policy.go`
- Browser grants: `app/src/features/browser/browserAgentAccess.ts`
- Existing inline Code AI: `app/src/features/coding-workspace/ai/InlineRewrite.tsx`
- Smart Library model/schema: `app/src/features/spaces/library/smartLibrary.ts`
- Smart Library and media embeddings: `server/internal/agents/smart_library_*` and `server/internal/platform/httpapi/media_search_*`
- Notes editor: `app/src/features/notes/components/NoteBlockEditor.tsx`
- Planner and roadmap: `app/src/features/spaces/planner/` and `app/src/features/spaces/roadmap/`
- Inbox: `app/src/features/inbox/`
- Provider budget controls: `server/internal/agents/provider_budget_limits.go`
- MCP transport security: `server/internal/integrations/mcp/security.go`

## Appendix B — research source index

- [Notion AI overview](https://www.notion.com/help/notion-ai-faqs)
- [Notion Agent Skills and selection actions](https://www.notion.com/help/create-and-manage-skills)
- [Notion AI database autofill](https://www.notion.com/en-gb/help/autofill)
- [Gemini in Google Docs](https://support.google.com/docs/answer/14206696)
- [Gemini in Gmail](https://support.google.com/mail/answer/14355636)
- [Gemini suggested meeting times](https://support.google.com/calendar/answer/16690875)
- [Microsoft Planner Agent](https://support.microsoft.com/en-us/Planner/what-can-you-do-with-planner-agent-in-copilot)
- [Linear Agent](https://linear.app/docs/linear-agent)
- [Asana AI project management](https://asana.com/product/ai/project-management)
- [Slack AI guide](https://slack.com/help/articles/25076892548883-Guide-to-AI-features-in-Slack)
- [Slack AI security](https://slack.com/help/articles/28310650165907-Security-for-AI-features-in-Slack)
- [Copilot in Microsoft Edge](https://support.microsoft.com/en-us/microsoft-copilot/getting-started-with-copilot-in-microsoft-edge)
- [ChatGPT Atlas sidebar and browser agent](https://help.openai.com/en/articles/12628199)
- [GitHub Copilot concepts](https://docs.github.com/en/copilot/concepts)
- [GitHub agentic workflows](https://docs.github.com/en/copilot/concepts/agents/about-github-agentic-workflows)
- [Warp Active AI](https://docs.warp.dev/agent-platform/local-agents/active-ai)
- [Warp full terminal use](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use)
- [Miro AI sticky notes](https://help.miro.com/hc/en-us/articles/28781881506834-Miro-AI-with-Sticky-notes)
- [Miro AI reference](https://help.miro.com/hc/en-us/articles/20970362792210-Miro-AI-reference)
- [Figma AI tools](https://help.figma.com/hc/en-us/articles/23870272542231-Use-AI-tools-in-Figma-Design)
- [Dropbox Dash search versus chat](https://help.dropbox.com/view-edit/dash-search-vs-chat)
- [Motion tasks and AI capture](https://www.usemotion.com/help/project-management/task)
- [Adobe Firefly generative fill](https://helpx.adobe.com/firefly/web/work-with-images/edit-images/generative-fill.html)
- [OWASP AI Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [OWASP Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [Google PAIR Explainability and Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/)
