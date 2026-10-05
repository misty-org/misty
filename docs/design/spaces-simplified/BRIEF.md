# Spaces, simplified: design brief

Status: decided 2026-10-16. Not built yet. This brief supersedes the Planner,
roadmap and agenda parts of `docs/design/spaces-chat/` and
`docs/design/space-creation/`, and the agent listing rules in
`docs/plans/roadmap.md` §1.

## Why

A Space is where people and agents make things together, and seeing them made
is what sets Misty apart from a chat app. Every tool in a Space is either a
place to ask or a thing that gets made. Anything else goes.

## The Space after this change

Five tools in the Space rail, in this order:

| Tool | What it holds | Who makes it |
| --- | --- | --- |
| **Chat** | The Space's conversation: people, agents and their replies | Everyone |
| **Pages** | Notes and drawings in one list; each page is a doc or a canvas | People and agents |
| **Tasks** | Today's tasks, board and list views, unchanged | People and agents |
| **Code** | The Space's code projects and what agents changed in them | Agents, with people |
| **Files** | Uploaded and generated files and images | People and agents |

## Decisions

1. **Remove roadmaps.** Goals, milestones, the node canvas and node definitions
   go, with their 19 routes, the `roadmap.*` agent tools and their tables
   (about 7,100 lines). Existing roadmaps are dropped. They aren't exported.
2. **Remove the agenda, Misty's own calendar.** Space calendar events, calendar
   sources and the Google calendars linked into a Space go, with `event.*` and
   about 3,000 lines. A person's calendar is the one they connect (Google,
   Outlook) through integrations, so "my calendar" always means that one. Task
   due dates stay.
3. **Remove the Planner wrapper.** Tasks become their own tool. The board and
   list views, filters, drawers and `task.*` agent tools stay as they are.
4. **Pages replaces Journal.** One list of notes and drawings, newest first, each
   marked "Doc" or "Canvas" by an icon and a word. Creating a page asks which
   kind. Routes stay `/notes` and `/drawings` underneath.
5. **Code is a new tool.** It lists the code projects linked to the Space. Each
   row shows the project's name, its GitHub repository when published, and its
   latest changes. Opening a project shows its changes by run, using Claude-style
   diffs (`src/features/agents/components/changes/`), its snapshots and its
   previews. Project files stay on the device that has the project, as today;
   others in the Space see the project, its changes and its GitHub link.
6. **Remove the Smart Library's background AI.** Face grouping (people),
   auto-tags, captions and video and audio indexing stop and their code goes.
   Uploads no longer run models. Files keep name and text search.
7. **Remove Space templates.** Create a Space no longer offers a template grid;
   a new Space starts with the five tools, empty.
8. **Remove agent listings.** Agents are plain members of a Space. Any member
   can @mention an agent in the Space; the request is billed to whoever asked,
   as today. There is no accept policy (ask, auto or off) and no listing rows.
   To stop an agent answering in a Space, remove it from the Space's members.

## What stays as it is

- Chat, members and invitations, and the personal Space.
- Tasks, apart from losing the Planner wrapper.
- Artifacts from agent work saving to the agent's Space (roadmap §1).
- Encrypted sync, item read state and storage accounting.

## Open questions

- Should the Code tool show projects from every member, or only projects
  someone explicitly linked to the Space?
- Do removed tables get a migration that drops them, or a later cleanup once
  production has no readers?

## Rules followed

These come from AGENTS.md: monochrome only, with item-type tones on rows;
checkmarks in menus; no loading text; failures inline in plain language.
