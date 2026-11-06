# Spaces

A Space is shared content pulled from the server. It has an owner and members, no roles or
permissions, and each person's agents are listed under them. Every profile sees the same set of
Spaces, because they belong to the signed-in person. A Space owns no tabs or sign-ins, and leaving or
deleting one never touches browsing data. Each window remembers its own current Space on that
computer; choosing one changes what the Space row and panels show and where new agent conversations
go, never tabs. Each Space also has a memory tree of what it remembers.

| Item | Who can see it |
| --- | --- |
| Group chats | Everyone in the Space, and everyone who joins later |
| DMs | Only the people in them, not the Space's owner (`space_conversations.kind = 'dm'`) |
| Agent conversations | Only their owner, always ([agents](../agents/README.md#where-conversations-live)) |
| Agents | Each person has their own |
| Artifacts and other items | Private or public toggle (`visibility`) |
| Memory tree | Only its owner, per Space, on the server ([memory](../voice-memory/README.md)) |

Conversations people had in private before DMs had their own kind became DMs, so nothing written in
private became public.

## Read first

| To learn about | Read |
| --- | --- |
| The simplified model: owner, members, one chat system | [simplified.md](simplified.md) |
| Profiles, windows and the vault, which are separate from Spaces | [../sync/README.md](../sync/README.md) |
| What is still being built | [../plans/spaces-as-profiles.md](../plans/spaces-as-profiles.md) |
| The memory tree | [../voice-memory/README.md](../voice-memory/README.md) |

Code lives in `src/features/spaces/` and `src/features/workspace/`.

## Interface rules

- Exception: a window's color comes from its profile, not its Space (`src/features/workspace/windowColors.ts`): a quiet wash over the window's chrome (the frame and tab strip). Page content, hover, focus and selection stay monochrome, and the selected color shows a checkmark.

- Spaces follow `docs/spaces/simplified.md`: an owner and members with no roles or permissions, agents listed under their person. A window shows one Space at a time and switches in place. The Space's controls are the Space row in the Space bar above the pages (`SpaceRow` in `src/features/spaces/components/spaceRow/`, `SpaceBar` in `src/app/layouts/DesktopLayout/`): the Space's avatar and name with its menu (Spaces with a checkmark, Open in new window, New Space, Rename, Color, Sites that open here, Leave or Delete), then Home, Chat, People and the Memory icon (Lucide `Brain`). The Memory icon opens the Space's memory tree; Start capture and Stop capture are a button inside the tree, at its left. The button at the bar's far right auto-hides only the Space bar, or keeps it open; turned on, it tucks away at once. The tab sidebar has its own toggle. Settings › Interface offers the same choice; the first-run tabs step sets both bars at once. Signed out, the bar still shows these controls, and pressing any of them opens the sign-in sheet. There is no Space settings page (Settings › Agents holds the device settings for agents in Spaces) and no bar inside Space pages; nothing else adds rails, pills, launchers or a ⌘K palette. The Space home is the gallery with a "Create" row in gray; there are no pins or favorites. The address bar only opens the shared ⌘T panel, and panel rows show the target, never a verb.

