export type ProductScreenshotSlotId =
  | "home-dashboard"
  | "space-overview"
  | "space-chat"
  | "tasks-board"
  | "space-library"
  | "connections"
  | "agent-workspace"
  | "private-files";

export type ProductScreenshotSlot = {
  filename: string;
  src?: string;
  width: number;
  height: number;
  alt: string;
  route: string;
  desiredState: string;
};

/**
 * The single inventory for every product visual on the marketing site.
 *
 * A slot without `src` deliberately renders its responsive DOM preview. Drop
 * the approved capture into `public/screenshots` and add `src` here to replace
 * every use of that preview across the site at once.
 */
export const productScreenshotSlots: Record<
  ProductScreenshotSlotId,
  ProductScreenshotSlot
> = {
  "home-dashboard": {
    filename: "misty-home-dashboard-live.png",
    src: "/screenshots/misty-home-dashboard-live.png",
    width: 2992,
    height: 1876,
    alt: "Misty home dashboard with apps, an agenda, collaborative Spaces, and a work streak",
    route: "/home",
    desiredState:
      "Home with apps, an agenda, work rhythm, and several Spaces.",
  },
  "space-overview": {
    filename: "misty-space-overview.webp",
    src: "/screenshots/misty-space-overview.webp",
    width: 940,
    height: 500,
    alt: "Misty overview showing recent apps, a weekly work rhythm, and three collaborative Spaces",
    route: "/home",
    desiredState: "Home crop centered on recent apps and the Space switcher.",
  },
  "space-chat": {
    filename: "misty-space-chat.webp",
    width: 1600,
    height: 1000,
    alt: "Misty Space with members working together in Chat",
    route: "/spaces/:spaceId/chat",
    desiredState:
      "Active project conversation with members, an Agent, and useful shared context.",
  },
  "tasks-board": {
    filename: "misty-tasks-board.webp",
    width: 1600,
    height: 1000,
    alt: "Misty Planner with a shared task board",
    route: "/spaces/:spaceId/planner/tasks/board",
    desiredState:
      "Populated task board with owners, priorities, due dates, and completed work.",
  },
  "space-library": {
    filename: "misty-space-library.webp",
    src: "/screenshots/misty-space-library.webp",
    width: 1600,
    height: 1000,
    alt: "Misty Space Library with shared research, recordings, documents, and visual references",
    route: "/spaces/:spaceId/library",
    desiredState:
      "Populated Library in grid view with several recognizable file types.",
  },
  connections: {
    filename: "misty-connections.webp",
    width: 1600,
    height: 1000,
    alt: "Misty connections for apps and external services",
    route: "/marketplace",
    desiredState:
      "Connections catalog with at least one active integration and clear availability states.",
  },
  "agent-workspace": {
    filename: "misty-agent-workspace.webp",
    width: 1600,
    height: 1000,
    alt: "A Misty Agent working beside the apps in a project workspace",
    route: "/agents",
    desiredState:
      "Successful Agent response with its permitted context and tools visible.",
  },
  "private-files": {
    filename: "misty-private-files.webp",
    width: 1600,
    height: 1000,
    alt: "Misty Files with local and connected storage kept private",
    route: "/files",
    desiredState:
      "Files with local and connected locations, useful content, and private/shared state visible.",
  },
};
