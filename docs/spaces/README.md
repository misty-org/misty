# Spaces

A Space is the place work lives. It has an owner and members, no roles or permissions, and
each person's agents are listed under them. A window shows one Space at a time and switches in
place, and each Space has a color. Each Space also has a memory tree of what it remembers.

## Read first

| To learn about | Read |
| --- | --- |
| The simplified model: owner, members, one chat system | [simplified.md](simplified.md) |
| Spaces as profiles: vaults, private and public layers, switching in place | [as-profiles.md](as-profiles.md) |
| What is still being built | [../plans/spaces-as-profiles.md](../plans/spaces-as-profiles.md) |
| The memory tree | [../voice-memory/README.md](../voice-memory/README.md) |

Code lives in `src/features/spaces/` and `src/features/workspace/`.

## Interface rules

- Exception: each Space has a color (`src/features/workspace/windowColors.ts`), and a window takes the color of the Space it shows now: a quiet wash over the window's chrome (the frame and tab strip), changing when the window switches Space, and the swatch in the Space menu's Color list. Page content, hover, focus and selection stay monochrome, and the selected color shows a checkmark. A Space is given a color before any window shows it. Incognito windows show their Space's color too.

- Spaces follow `docs/spaces/simplified.md` and `docs/spaces/as-profiles.md`: an owner and members with no roles or permissions, agents listed under their person. A window shows one Space at a time and switches in place. The Space's controls are the Space row in the Space bar above the pages (`SpaceRow` in `src/features/spaces/components/spaceRow/`, `SpaceBar` in `src/app/layouts/DesktopLayout/`): the Space's avatar and name with its menu (Spaces with a checkmark, Open in new window, New Space, Rename, Color, Sites that open here, Leave or Delete), then Home, Chat, People and the Memory icon (Lucide `Brain`). The Memory icon opens the Space's memory tree; Start capture and Stop capture are a button inside the tree, at its left. The Space bar can auto-hide (Settings › Appearance). There is no Space settings page and no bar inside Space pages; nothing else adds rails, pills, launchers or a ⌘K palette. The Space home is the gallery with a "Create" row in gray; there are no pins or favorites. The address bar only opens the shared ⌘T panel, and panel rows show the target, never a verb.

