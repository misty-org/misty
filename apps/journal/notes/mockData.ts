import type { UnifiedNote } from "./model/types/types";

// Fixed clock so the demo renders identical relative timestamps on every run.
const now = new Date("2026-07-20T16:40:00.000Z").getTime();

function at(minutesAgo: number): string {
  return new Date(now - minutesAgo * 60_000).toISOString();
}

export const MISTY_CONNECTOR_ID = "notes:misty";

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
      "- [ ] Block editor reviewed with design",
      "- [ ] Space-scoped note creation verified on Windows",
      "",
      "Local save errors should read as *recoverable*. A note that failed to save",
      "should keep the draft visible instead of blocking the pane.",
    ].join("\n"),
    preview:
      "Ship gates for the beta: connector status, search across tags and Spaces, and the native block editor.",
    spaceId: "space-product",
    spaceName: "Product",
    tags: ["beta", "launch"],
    backlinks: ["Block editor polish", "Connector status vocabulary"],
    updatedAt: at(24),
    createdAt: at(60 * 24 * 9),
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
    syncStatus: "synced",
    connectorId: MISTY_CONNECTOR_ID,
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
