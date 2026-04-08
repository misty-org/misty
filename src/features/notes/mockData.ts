import type { UnifiedNote } from "@/models/types/features/notes/types";

// Fixed clock so the demo renders identical relative timestamps on every run.
const now = new Date("2026-07-20T16:40:00.000Z").getTime();

function at(minutesAgo: number): string {
  return new Date(now - minutesAgo * 60_000).toISOString();
}

export const MISTY_CONNECTOR_ID = "notes:misty";
export const NOTION_CONNECTOR_ID = "notes:notion";

export const mistyNoteSeed: UnifiedNote[] = [
  {
    id: "misty:beta-launch-checklist",
    source: "misty",
    sourceId: "beta-launch-checklist",
    title: "Beta launch checklist",
    bodyFormat: "markdown",
    body: [
      "## Ship gates",
      "",
      "- [x] Connector status surfaces in every source row",
      "- [x] Search spans title, preview, tags, source, and Space",
      "- [ ] Notion read sync verified against a real workspace",
      "- [ ] Conflict copy reviewed with design",
      "",
      "Sync errors should read as *recoverable*. A note that failed to sync is",
      "still readable from cache — say so instead of blocking the pane.",
    ].join("\n"),
    preview:
      "Ship gates for the beta: connector status in every row, search across tags and Spaces, Notion read sync.",
    spaceId: "space-product",
    spaceName: "Product",
    tags: ["beta", "launch"],
    backlinks: ["Notion sync design", "Connector status vocabulary"],
    updatedAt: at(24),
    createdAt: at(60 * 24 * 9),
    favorite: true,
    syncStatus: "synced",
    connectorId: MISTY_CONNECTOR_ID,
    providerStatus: "connected",
  },
  {
    id: "misty:connector-status-vocabulary",
    source: "misty",
    sourceId: "connector-status-vocabulary",
    title: "Connector status vocabulary",
    bodyFormat: "markdown",
    body: [
      "Every integration reports one of five states. Notes reuses the same set",
      "rather than inventing note-specific language:",
      "",
      "| State | Meaning |",
      "| --- | --- |",
      "| `connected` | Credentials valid, last sync succeeded |",
      "| `syncing` | Fetch in flight |",
      "| `needs_reconnect` | Token expired, user action required |",
      "| `error` | Last sync failed, cached data still served |",
      "| `disconnected` | Never connected, or explicitly removed |",
    ].join("\n"),
    preview:
      "Five shared states across every integration: connected, syncing, needs_reconnect, error, disconnected.",
    spaceId: "space-platform",
    spaceName: "Platform",
    tags: ["connectors", "design"],
    backlinks: ["Beta launch checklist"],
    updatedAt: at(190),
    createdAt: at(60 * 24 * 21),
    favorite: false,
    syncStatus: "synced",
    connectorId: MISTY_CONNECTOR_ID,
    providerStatus: "connected",
  },
  {
    id: "misty:pricing-scratch",
    source: "misty",
    sourceId: "pricing-scratch",
    title: "Pricing scratch pad",
    bodyFormat: "markdown",
    body: [
      "Rough notes, not shared yet.",
      "",
      "- Seat pricing punishes the exact team shape we want (small, many Spaces)",
      "- Connector count is the wrong meter — usage is bursty",
      "- Storage-plus-active-Spaces is closer to felt value",
    ].join("\n"),
    preview: "Rough notes: seat pricing punishes small teams, connector count is the wrong meter.",
    tags: ["pricing"],
    backlinks: [],
    updatedAt: at(52),
    createdAt: at(60 * 30),
    favorite: false,
    syncStatus: "local-only",
    connectorId: MISTY_CONNECTOR_ID,
    providerStatus: "connected",
  },
  {
    id: "misty:onboarding-teardown",
    source: "misty",
    sourceId: "onboarding-teardown",
    title: "Onboarding teardown — first 90 seconds",
    bodyFormat: "markdown",
    body: [
      "Watched six installs. The drop-off is always the same beat: the app is",
      "empty and the next action is ambiguous.",
      "",
      "1. Connect a source, or",
      "2. Write something native",
      "",
      "Both paths should be one click from an empty Notes list.",
    ].join("\n"),
    preview:
      "Six installs watched. Drop-off happens when the app is empty and the next action is ambiguous.",
    spaceId: "space-product",
    spaceName: "Product",
    tags: ["research", "onboarding"],
    backlinks: ["Beta launch checklist"],
    updatedAt: at(60 * 27),
    createdAt: at(60 * 24 * 4),
    favorite: false,
    syncStatus: "synced",
    connectorId: MISTY_CONNECTOR_ID,
    providerStatus: "connected",
  },
];

export const notionNoteSeed: UnifiedNote[] = [
  {
    id: "notion:roadmap-h2",
    source: "notion",
    sourceId: "a1f4c2e0-7b3d-4c11-9f2a-6d8e0b5c3a91",
    title: "H2 Roadmap",
    bodyFormat: "notion-blocks",
    body: [
      "## Q3",
      "",
      "Unified workspace layer — Notes, Files, and Spaces addressable from one",
      "search box.",
      "",
      "## Q4",
      "",
      "Two-way Notion editing. Read-first until conflict handling is proven.",
    ].join("\n"),
    preview:
      "Q3: unified workspace layer across Notes, Files, and Spaces. Q4: two-way Notion editing.",
    spaceId: "space-product",
    spaceName: "Product",
    tags: ["roadmap"],
    backlinks: ["Beta launch checklist"],
    updatedAt: at(96),
    createdAt: at(60 * 24 * 40),
    favorite: true,
    syncStatus: "synced",
    sourceUrl: "https://www.notion.so/a1f4c2e07b3d4c119f2a6d8e0b5c3a91",
    connectorId: NOTION_CONNECTOR_ID,
    providerStatus: "connected",
  },
  {
    id: "notion:notion-sync-design",
    source: "notion",
    sourceId: "b2e5d3f1-8c4e-4d22-a03b-7e9f1c6d4b02",
    title: "Notion sync design",
    bodyFormat: "notion-blocks",
    body: [
      "Read path is a normalized fetch: pages become `UnifiedNote` records with",
      '`bodyFormat: "notion-blocks"`. Misty never renders Notion block JSON',
      "directly — the connector flattens it first.",
      "",
      "Write path stays closed for beta. Opening it needs block-level identity,",
      "which we do not preserve yet.",
    ].join("\n"),
    preview:
      "Read path normalizes pages into UnifiedNote records. Write path stays closed until block identity is preserved.",
    spaceId: "space-platform",
    spaceName: "Platform",
    tags: ["connectors", "notion"],
    backlinks: ["Connector status vocabulary"],
    updatedAt: at(60 * 20),
    createdAt: at(60 * 24 * 12),
    favorite: false,
    syncStatus: "conflict",
    sourceUrl: "https://www.notion.so/b2e5d3f18c4e4d22a03b7e9f1c6d4b02",
    connectorId: NOTION_CONNECTOR_ID,
    providerStatus: "connected",
  },
  {
    id: "notion:customer-interviews",
    source: "notion",
    sourceId: "c3f6e4a2-9d5f-4e33-b14c-8f0a2d7e5c13",
    title: "Customer interviews — July",
    bodyFormat: "notion-blocks",
    body: [
      "Eleven calls. The recurring ask is not another editor.",
      "",
      '> "I don\'t want to move my docs. I want to stop looking in four places."',
      "",
      "Which is the whole thesis: Misty is a layer, not a replacement.",
    ].join("\n"),
    preview:
      "Eleven calls. Nobody asked for another editor — they asked to stop looking in four places.",
    tags: ["research"],
    backlinks: [],
    updatedAt: at(60 * 44),
    createdAt: at(60 * 24 * 6),
    favorite: false,
    syncStatus: "error",
    sourceUrl: "https://www.notion.so/c3f6e4a29d5f4e33b14c8f0a2d7e5c13",
    connectorId: NOTION_CONNECTOR_ID,
    providerStatus: "connected",
  },
  {
    id: "notion:meeting-notes-platform",
    source: "notion",
    sourceId: "d4a7f5b3-0e60-4f44-c25d-9a1b3e8f6d24",
    title: "Platform sync — weekly",
    bodyFormat: "notion-blocks",
    body: [
      "Agenda carried over: connector retry budget, cache eviction, and whether",
      "sync errors should page anyone (they should not).",
    ].join("\n"),
    preview:
      "Carried over: connector retry budget, cache eviction, whether sync errors should page anyone.",
    spaceId: "space-platform",
    spaceName: "Platform",
    tags: ["meeting"],
    backlinks: [],
    updatedAt: at(60 * 8),
    createdAt: at(60 * 24 * 2),
    favorite: false,
    syncStatus: "synced",
    sourceUrl: "https://www.notion.so/d4a7f5b30e604f44c25d9a1b3e8f6d24",
    connectorId: NOTION_CONNECTOR_ID,
    providerStatus: "connected",
  },
];

export const mockSpaces = [
  { id: "space-product", name: "Product" },
  { id: "space-platform", name: "Platform" },
];

/**
 * Demo-only. Seed notes carry placeholder Space ids, so opening a real Space
 * would show an empty "In this Space". This re-homes the Product-tagged seeds
 * onto whichever Space is open. A real connector filters by Space server-side
 * and this disappears entirely.
 */
export function applyDemoSpace(
  notes: UnifiedNote[],
  spaceId: string,
  spaceName: string,
): UnifiedNote[] {
  return notes.map((note) =>
    note.spaceId === "space-product" ? { ...note, spaceId, spaceName } : note,
  );
}
