# Spaces as profiles: design brief

Status: proposed 2026-10-16, decisions below agreed in conversation; not built. It builds
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
- **Windows.** Virtual windows are removed. Opening a Space opens a new OS window in that
  profile, as Chrome does with profiles; every window belongs to one Space. The Space
  takes over the window's chosen color (`windowColors.ts`) and its AGENTS.md color
  exception.

### What the sync tree doesn't hold yet

| Not in the tree | Today |
| --- | --- |
| Installed extensions and whether each is on | On the device; only their synced settings travel |
| Downloads list | On the device |
| Per-site permissions (camera, notifications, pop-ups) | On the device |
| Autofill addresses and cards | Not stored |
| Custom search engines and bangs | On the device |
| App settings | On the device by AGENTS.md rule; stays that way |

## Private and public

No roles and no permission settings. Everything in a Space is private or public, like
`private` and `public` in a class.

**Private (each person's own):**
- the sync tree (their tabs, windows, sign-ins, history, bookmarks, passwords)
- the memory tree (below)
- the integrations tree: the apps they connected in this Space, so work Gmail and
  personal Gmail can live in different Spaces
- their private chats, including DMs with their agents

**Public (everyone in the Space):** the gallery (notes, drawings, images, files, code),
chat channels and threads, and the Space's agents, which members can @mention.

**The one rule:** an agent can read a private layer only when it belongs to that layer's
owner. Anyone else's agent sees the public layer and nothing else. In a Space only you
belong to, everything is private.

## Agents

Agents belong to a Space and to the person who made them. The quick agent panel still
just lists agents; whatever you ask runs in the current window's Space. The full Agents
page groups agents by Space.

## The memory tree

Each person has one memory tree per Space, inside that Space's vault, encrypted end to end
like the rest of the sync tree. The server never reads it.

| Branch | What it holds | Replaces |
| --- | --- | --- |
| Moments | Pages read, voice and dictation, recordings, captures, in hourly batches like history | `memory_events` |
| Summaries | Day recaps built from moments | `ai_recaps` results |
| Facts | Things to remember (`memory.pref`) | `misty_memories` |
| Workflows | Saved requests and their learned steps (`memory.workflow`) | `agent_methods`, `agent_method_versions`, `agent_method_lessons` |

- **Search runs on the device,** with full-text search and on-device embeddings, so the
  server no longer pays to embed memory.
- **Agents read and write memory through the device,** as `web.fetch` runs there today.
  When no device of the owner is online, the request waits as a queued device job for up
  to one day; past that, the run says it couldn't reach memory and finishes without it.
- **Learning happens on the device.** The device sees a run's steps as they stream, so it
  writes the learned steps into the vault itself; the server can't.
- The server's memory tables move into the vaults and are then dropped.

## Plans

The number of Spaces depends on the plan: a few on Basic and unlimited on Pro and above,
which fits the free plan funded by paying users (`docs/plans/pricing-v2.md`).

## Still open

- How many Spaces Basic gets (two is the working assumption).
- Whether the parts missing from the sync tree (extensions, downloads, site permissions,
  autofill, bangs) join it or stay on the device.
- Where the integrations tree lives: connected accounts are held by Composio, so it can
  only be a per-Space, owner-only list kept by the server.
- Separate web data per Space: WebKit keeps sign-ins apart with a data store per
  identifier (macOS 14 and later), which needs a spike first.
- Moving existing data: today's vault becomes the personal Space; virtual windows become
  Spaces only if the person chooses; server memory moves into the personal Space's vault.

## Rules followed

These come from AGENTS.md: monochrome apart from the listed exceptions; checkmarks in
menus; no loading text; plain-language failures; settings stay on the device.
