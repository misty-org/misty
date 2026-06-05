# Product screenshot inventory

All marketing visuals resolve through `src/content/productScreenshotSlots.ts`.
When a capture is unavailable, the site renders its responsive DOM preview and
marks the element with `data-screenshot-status="placeholder"`. Adding the file
and its `src` entry swaps every use of that slot at once.

| Slot | Filename | Product route | Status |
| --- | --- | --- | --- |
| Home dashboard | `misty-home-dashboard.webp` | `/home` | Ready |
| Apps and Spaces overview | `misty-space-overview.webp` | `/home` | Ready |
| Space Chat | `misty-space-chat.webp` | `/spaces/:spaceId/chat` | Needed |
| Planner task board | `misty-tasks-board.webp` | `/spaces/:spaceId/planner/tasks/board` | Needed |
| Space Library | `misty-space-library.webp` | `/spaces/:spaceId/library` | Ready |
| Connections | `misty-connections.webp` | `/marketplace` | Needed |
| Agent workspace | `misty-agent-workspace.webp` | `/agents` | Needed |
| Private Files | `misty-private-files.webp` | `/files` | Needed |

## Capture standard

- Capture at 1600 × 1000 unless the slot specifies otherwise.
- Use believable demo content with no personal data, debug text, failures,
  notifications, open menus, hover states, or visible pointer.
- Show the complete Misty window for context; crop only when the slot asks for
  a detail view.
- Prefer populated, successful states that prove the accompanying claim.
- Export WebP at high visual quality and keep each file below 250 KB.
