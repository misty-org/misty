# Spaces, simplified: design brief

Status: decided and built 2026-10-16 (phases 1–6), in `main`. It supersedes the
Planner, roadmap, agenda, template and permission parts of the earlier Spaces chat
and Space creation briefs (since removed), the Space rail brief, and the earlier
version of this brief (Pages, Tasks). Navigation has moved on since: see
[sync](../sync/README.md) and AGENTS.md.

## Why

A Space is an organized, shareable place where people and their agents make
things together. It holds only true primitives, chat is the one way to talk to
anyone, person or agent, and anyone in the Space can work with anyone else's
agents. Misty is mostly a browser, so tabs and the Space bar are the only chrome
and ⌘T is the way in.

## What a Space holds

| Section | What it holds |
| --- | --- |
| **Chat** | Channels, threads and DMs, with people and agents |
| **Notes** | Documents, written by people and agents |
| **Drawings** | Canvases |
| **Files** | Files and folders, shown as cards with live previews |

The sections sit in the Space page's own header, with ⌘1 to ⌘4. There is no
Space rail or tool strip.

## Members and agents

- A Space has an **owner and members**. Only the owner invites, removes people
  or deletes the Space. There are no roles and no per-member permissions.
- **An invitation is how new people join a server.** After a server's first account, an email
  address can create an account only while a Space invitation to it is pending
  ([../self-hosting.md](../self-hosting.md#accounts)). Inviting answers with the invitation's
  link (`misty://open/invite/…`), which the invite dialog shows with a Copy button for the owner to
  send; a server with [Mailjet](../self-hosting.md#email) also emails it. Pending invitations offer **New link**, which
  replaces the old link and shows the new one the same way.
- **Agents are members under a person.** You bring your own agents into any
  Space you're in (`space_agents`), and an agent can be in many Spaces. The
  member list shows each person with their agents under them. When a person
  leaves, their agents leave with them.
- **Asking someone else's agent:** @mention it in a channel or thread. It sees
  the Space and keeps its own memory, which others' asks can read but not
  change. Its owner's connected apps, files outside the Space and private chats
  stay off-limits. The run is billed to the person who asked and starts at once:
  there is no accept policy and no approval step, only the usual pauses before
  paying, deleting or other irreversible actions, which go to whoever asked.
- Every person keeps a **personal Space**, where agent conversations go by default.

## One chat system

- Every chat is a `space_conversations` row: a group chat, public to the Space, or a DM,
  seen only by the people in it. Agent conversations aren't here: they're always private to
  their owner ([agents](../agents/README.md#where-conversations-live)).
- Agents talk to each other in the chat: an agent that @mentions another in its
  reply starts that agent's run in the same thread, one hop deep.

## Files and Code

- Files are files and folders only. Cards preview images, PDFs, Markdown, CSV
  as a table, code with highlighting, and HTML in a sandboxed frame that can't
  reach Misty. Agent outputs are ordinary files, credited to the agent and run
  that made them.
- Trash is an ordinary collection for every member: there is no Library lock.
- Agents can read a folder on the person's computer only when it's shared and
  chosen for that chat. Shared folders are read-only.

## Navigation

- Tabs sit in the tab sidebar, and the Space bar above the pages carries the
  Space row (AGENTS.md). The navigator rail, the Spaces and Agents pills and the
  app launcher are gone: Spaces, Agents, Bookmarks and Settings are pages that
  open in tabs.
- ⌘T opens a new tab whose page is the panel; ⌘L or a click on the address bar
  opens the same panel over the current tab. The address bar is only a doorway:
  all typing happens in the panel.
- The panel guesses what the input is, with no model call: a URL opens, keywords
  search the web, a request or question asks your agent (its DM opens), and a
  name jumps to a place, Space section, agent, file, note or open tab. The guess
  sits on top with the alternatives under it. ⌘⏎ opens beside, in a split.
- Rows show only the target, never a verb; the icon says what Enter does.
- Bangs: `!chat`, `!notes`, `!drawings`, `!files`, `!code`, `!spaces`,
  `!agents`, `!bookmarks`, `!history`, `!tabs`, `!downloads`, `!settings`,
  `!extensions` and `!ask`; `@agent` asks that agent. Web and custom bangs stay.
- There is no ⌘K and no Global Misty overlay. Misty is one of your agents.

## Removed, with their data

Roadmaps, the agenda and Misty's own calendar, the Planner and tasks, Space
templates, roles and permission overrides, agent listings and accept policies,
and every Library extra: albums, people, stacks, groups, pins, imports, the
Library lock, semantic search and all Smart Library background AI. Their tables
are dropped by migration, with no export.

## Still open

- Device-local pick history doesn't bias the panel's guess yet.
- Agent work in channel replies shows the final answer, not the live work lines.

## Rules followed

These come from AGENTS.md: monochrome only, with item-type tones on rows;
checkmarks in menus; no loading text; failures inline in plain language; agent
conversations follow `docs/agents/mockups/chat.html/`.
