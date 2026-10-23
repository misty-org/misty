# Agent browser: agents work inside your window

Status: approved and built 2026-10-19 (`src/features/agents/agentBrowser/`). It replaced the agent
window, the dock and the carousel in [agents-at-cursor/BRIEF.md](cursor-companion.md): no
agent gets an OS window of its own.

## Why

Each working agent had its own Misty window: a full copy of the app (its interface, stores, sync
and extension host) plus every tab it opened. Measured on October 19:

- An agent window's interface alone used 150 to 600 MB, before any page.
- Heavy sites cost 400 to 600 MB a page while open, and agents opened 5 to 30 pages a task.
- Closed tabs and windows left their page processes running; one 8-minute run reached 16 GB.
  That leak is fixed (pages now close with WebKit's own page close), but the design still kept
  every page of every agent live.

The goal is the least memory that does the work, with no limit a person ever runs into.

## Two layers of tabs

- **Your tabs** stay as they are: the app's tab strip, yours alone. They do not sleep.
- **An agent's tabs** live in that chat's agent browser, with their own strip. They never mix with
  yours: an agent cannot crowd, close or reuse your tabs, and the pages it kept as proof stay with
  the chat that made them.
- **Move to my tabs** on an agent's tab hands that page to you.

## Views

A chat's agent can work on several things at once (researching in one place while it writes in
another). Each line of work is a **view**: one worker (the agent or a sub-agent it started) with
its own tabs.

- The agent browser shows one view at a time. Above it, a **switcher** row of small labeled
  pictures (Research, Writing, Sources…) shows every view in the chat; a view working now is
  marked with its status word, and clicking one shows it.
- A chat runs **up to four views at once**. More lines of work wait in a queue and start as views
  finish; the agent closes a view itself when its work is done, so the queue keeps moving.
- A view that finished keeps its tabs, asleep, until the chat is closed.
- Views follow the agent-chat rules (docs/agents/mockups/chat.html/): status words beside icons, amber for
  waiting for you, monochrome otherwise.

## Split and picture-in-picture

- **Full split**: the open chat shows the conversation and the agent browser side by side, the
  browser with its view switcher, tab strip, toolbar and page.
- **PiP**: undocking shrinks the agent browser to a small picture of the shown view at the **top of
  the chat panel**, above the conversation. Clicking it expands to the full split again.
- The PiP belongs to the open chat only. Switching chats shows that chat's PiP, or none when its
  agent is not browsing. Nothing stacks and nothing floats over your pages.
- With several views working, the PiP shows "2 of 3" and flips between their pictures.
- The PiP is a picture refreshed after each step the agent takes, never a live page.
- Chats you are not looking at keep working; their sidebar row shows their status.

## Control

- While the agent acts, only its pages ignore your input; the chat, your tabs and the rest of the
  app stay yours. The ring goes around the agent browser area only.
- **Take over** in the chat pauses the run and hands you the agent's pages; **Resume** hands them
  back, and the agent reads its pages again before acting.
- **Stop** ends the run. Its tabs stay asleep in the chat as proof until you close the chat or
  move a page to your tabs.

## Memory

Only a page someone is looking at or acting on is rendered. Every other agent tab **sleeps**: it
keeps its address, title, scroll position and a picture, and its page is closed (WebKit's page
close, so its process goes too). It wakes when the agent acts on it again or you open it.

- **Adaptive live pages.** Any number of chats and views can run. Misty keeps as many agent pages
  live as free memory allows, from the system's memory pressure and the app's own footprint. When
  memory is short, views take turns: a view whose page is asleep waits between steps until a slot
  frees. Work slows under pressure; it never fails or meets a limit.
- **What sleeps first**: pages the agent left longest ago, then pages of views that are waiting
  on the model, never the page shown to you.
- **One close path.** Every agent page closes through one function that stops it, blanks it, closes
  the WebKit page and removes the view. Tests and every benchmark run check that the app's page
  processes return to their count before the run.
- **Pictures** are small images (JPEG, about 30 KB), kept per tab and replaced, never accumulated.

## Device-local, not synced

Agent tabs are a run's working state on the device that runs it, not part of your workspace.

- They are not in the sync tree: `workspaces` (window → tab → pane → view → page) holds only your
  tabs. The agent browser keeps its views and tabs in its own store, in memory, never in
  `misty.db`.
- An app restart starts clean: agent views and their sleeping tabs are gone. The chat keeps its
  answer, sources and links on this device, where the chat itself lives
  ([agent-chats-local/BRIEF.md](chats-local.md)).
- A page moved to your tabs becomes one of your tabs and syncs from then on.

## What goes away

- Agent OS windows: `agent_window_ensure`, `agentWindowSessions.ts`, the agent window's host,
  lock and workspace, and window docking in `MistyAgentDock.m`.
- The fanned dock stack and carousel. The PiP replaces them.
- Agent tabs come back into your window as the agent browser (`hostedSessions.ts` is the start).
- Unchanged: the page layer, grants and leases, popup handling, and the agent tools.

## Also on memory

- A hidden web view labeled `main` uses 128 MB at idle; find what creates it and remove or
  replace it.
- The cursor overlay is a full web view (46 MB); a native view does the same work.
- Measure a production build; the dev build's interface is larger.

## Plan

1. Agent tabs in your window with sleep and wake, one close path, and the leak check.
2. The agent browser in the full split: view switcher, tab strip, toolbar, lock and ring.
3. The PiP at the top of the chat panel, with pictures after each step.
4. Views from sub-agents: `agent_delegate` children open a view each.
5. Adaptive live pages under memory pressure.
6. Remove agent OS windows and the dock stack; update agents-at-cursor/BRIEF.md.
7. Measure: idle footprint, one agent, five chats with three views each; check that process counts
   return to baseline.
