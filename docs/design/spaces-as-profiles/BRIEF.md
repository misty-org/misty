# Spaces as profiles: design brief

Status: decided 2026-10-16; built in part (the build plan's status line says which phases). A
window switches its Space in place rather than opening an OS window per Space. The build plan is
[docs/plans/spaces-as-profiles.md](../../plans/spaces-as-profiles.md). It builds
on [Spaces, simplified](../spaces-simplified/BRIEF.md), which is built and in `main`, and
changes its agent model.

## The idea

A Space is a browser profile and much more: everything Misty knows and does for one part
of your life (work, school, family) lives in one Space. A work agent knows your work tabs,
captures and notes, and never sees your family's. Misty is the only browser where the
profile is also the boundary for AI.

## A profile is a sync tree

- **Account → devices → Spaces.** A person signs in on several devices; every device has
  all of their Spaces.
- **Each Space is one vault.** The sync tree and its logic stay exactly as they are:
  workspaces (window → tab → pane → view, with each view's page), website sign-ins with
  their one-writer lease, and the collections (bookmarks, saved tab groups, history,
  passwords, extensions' synced settings). The vault key already carries a `vault_id`,
  so a Space is a new `vault_id`, not new sync code.
- **One sync password unlocks every Space's vault.**
- **Windows.** Virtual windows are removed. An OS window shows one Space at a time and
  can switch in place, as Arc does (decided 2026-10-17, replacing one fixed Space per
  window). Switching swaps the tab strip to that Space's own tabs; the other Space's
  tabs stay as they were and come back when you switch back. Everything in the window
  follows its current Space: the website store new pages open in, extensions, sync,
  memory, agents and the window's color (`windowColors.ts`, under its AGENTS.md color
  exception). The native side keeps each window's current Space and only its switch
  command changes it; a page never picks its Space. "Open in new window" shows a Space
  in a second window, for two Spaces side by side.

### The Space row

The Space's controls live in the sidebar, not in a page (decided 2026-10-17):

- **Row 1** stays as it is: window controls, sidebar toggle, back, forward, reload.
- **Row 2, the Space row:** the Space's avatar and name with a ⌄ menu on the left, and the
  Space's Home, Chat and People buttons on the right. The bar that sat inside the Space
  home page goes away, so the window gains no bar.
- **The ⌄ menu** lists your Spaces with a checkmark on the current one, then Open in new
  window, New Space, Rename, Color, and Leave or Delete Space.
- **No Space settings page.** It only held a name and the members list: the name, color,
  leave and delete move into the ⌄ menu, and members (invite, remove, their agents) move
  to the People button.
- **Collapsed sidebar:** the Space's avatar and name sit at the left end of the tab strip,
  and its Home, Chat and People move into its ⌄ menu.

### Joining the sync tree

These join the sync tree as Space-wide collections (decided 2026-10-16):

- **Extensions:** which are installed in the Space and whether each is on, alongside the
  synced settings that already travel.
- **Site permissions:** camera, microphone, notifications and pop-up choices per site.
- **Search engines and bangs,** custom ones included.
- **Downloads list:** the record of past downloads; the files stay on the device that
  downloaded them.

App settings stay on the device, by the AGENTS.md rule. Autofill for addresses and cards
isn't stored anywhere yet; when it's built, it belongs in the sync tree next to passwords.

## Private and public

No roles and no permission settings. Public and private layers are the only permission
system, like `private` and `public` in a class, and every agent is built on that split.

**A toggle on every Space item.** Notes, drawings, images, files, code projects and agents
each have a private/public toggle. A private item stays in the Space but only its owner
sees it, and only the owner's agents on runs the owner asked for can read it. A private
agent is invisible to the rest of the Space and can't be @mentioned there. New items
start public in a shared Space and private in a Space only you belong to.

**Always private, no toggle:**
- the sync tree: tabs, windows, sign-ins, history, bookmarks, passwords, extensions, site
  permissions, search engines and bangs, downloads
- the memory tree (below)
- the integrations tree: a person connects each account once, and agents use all of their
  own accounts in every Space. Composio holds the tokens; there is no per-Space choice
- private chats, including DMs with their agents, and the runs inside them
- what lives only on their devices: shared folders, code project files, open tabs
- an agent's instructions and settings

**Always public, no toggle:** the Space's name, color and members; chat channels and
threads, with the agent replies and runs asked in them. A conversation only you can see is
a DM.

**The one rule:** a private layer or item opens only for its owner, and for the owner's own
agents on runs the owner asked for. When a teammate @mentions your agent, the run is theirs
and sees public items and nothing else; so does anyone else's agent.

## Incognito windows

Incognito is a window, as in Chrome, not a tab. An incognito window shows one Space at a
time like any other window, with one temporary session per Space shared by that Space's
incognito windows and erased when the last of them closes. Incognito is entirely local:
nothing in it syncs, reaches the server, enters memory or is seen by agents, and Misty does
nothing with it.

## Agents

Agents belong to a Space and to the person who made them. The quick agent panel still
just lists agents; whatever you ask runs in the window's current Space. The full Agents
page groups agents by Space.

## The memory tree

Each person has one memory tree per Space, kept on the server and always private: only its
owner, and the owner's agents on runs the owner asked for, can read it. It is not in the
vault and not end-to-end encrypted (decided 2026-10-17); the server keeps the text and the
search vectors, as it keeps memory today.

| Branch | What it holds | Today's tables |
| --- | --- | --- |
| Moments | Pages read, voice and dictation, recordings, captures, in hourly batches like history | `memory_events` |
| Summaries | Day recaps built from moments | `ai_recaps` |
| Facts | Things to remember (`memory.pref`) | `misty_memories` |
| Workflows | Saved requests and their learned steps (`memory.workflow`) | `agent_methods`, `agent_method_versions`, `agent_method_lessons` |

- **Search is by meaning,** with embeddings made and kept on the server. There is no
  full-text search. Every device and every agent searches the same index.
- **Agents read and write memory on the server,** in the run's Space, with no device
  online.
- **Learning happens on the server,** which sees a run's steps as it runs them.
- Today's memory tables stay and gain a Space: each row belongs to one person in one Space.

## Plans

Every plan gets as many Spaces as it wants. Plans limit cloud storage and AI usage, not
Spaces: ten small Spaces cost less than five gigabytes of files. A Space's vault, gallery
and chat count toward its owner's storage like everything else
(pricing lives in the billing repo).

## Smaller decisions

Settled 2026-10-17:

- **Clipboard:** one shared clipboard per account, kept in the personal Space's vault and used
  by every Space's windows, like the system clipboard.
- **Leaving a Space,** or its owner deleting it, deletes everything of yours in it: your vault,
  your memory tree and your private items, after a confirm that names what goes.
- **Memory moments** are kept until you delete them, and count toward your storage.
- **Links from other apps** open in the Space that claims the site; otherwise in the Space you
  used last, as Chrome does.

## Getting started

There is nothing to migrate: Misty has no users yet. Virtual windows are removed outright,
and today's local data becomes the personal Space. Onboarding teaches what a Space is and
how it works: a profile per part of your life, each with its own memory and agents, and how
much more the browser does because of it.

## Still open

Nothing blocks the build. Answered since the brief was written:

- **Separate web data per Space: answered.** Each Space gets its own named
  `WKWebsiteDataStore` through Tauri's `data_store_identifier`, with no wry or Tauri
  fork. Cookies, sign-ins, localStorage, IndexedDB and Cache Storage stay apart and
  survive a restart, and two extension controllers run side by side, one per Space
  (checked by the probe in `src-tauri/tests/webextensions/space-probe.m`). The work left is Misty's own:
  sync per vault, one extension host per Space and window labels per Space.
- **Minimum macOS: 14.0, raised with the Spaces build.** Named stores need macOS 14; on
  12 and 13 every Space would forget its sign-ins at quit. Extensions still need macOS
  15.4, as today.

## Rules followed

These come from AGENTS.md: monochrome apart from the listed exceptions; checkmarks in
menus; no loading text; plain-language failures; settings stay on the device.
