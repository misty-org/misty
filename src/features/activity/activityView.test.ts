import { describe, expect, it } from "vitest";
import { defaultActivityView, selectActivityView } from "./activityView";
import type { ActivityItem } from "./types";
const item = (id: string, extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id,
  accountId: "a",
  source: "device",
  sourceId: id,
  kind: "system",
  title: id,
  body: "",
  createdAt: "2026-09-09T00:00:00Z",
  attention: false,
  target: { kind: "none" },
  ...extra,
});
const items = [
  item("mention", { kind: "mention", title: "Design review", sourceLabel: "Studio" }),
  item("reply", { kind: "reply", readAt: "today" }),
  item("job", {
    kind: "completion",
    status: "completed",
    body: "Design export",
    sourceLabel: "Studio",
    updatedAt: "2026-09-10T00:00:00Z",
  }),
  item("approval", { kind: "approval", readAt: "today" }),
  item("noise", { visibility: "diagnostic" }),
];
describe("Activity view", () => {
  it("counts overlapping sections independently and keeps opened requests unread", () => {
    const result = selectActivityView(items, { ...defaultActivityView, section: "mentions" });
    expect(result.counts).toEqual({ all: 4, unread: 3, mentions: 1, system: 2 });
    expect(result.visible.map((x) => x.id)).toEqual(["mention"]);
  });
  it("combines all search words across fields, OR within groups and AND between groups", () => {
    const result = selectActivityView(items, {
      ...defaultActivityView,
      query: "STUDIO design",
      types: ["mention", "completion"],
      statuses: ["completed"],
    });
    expect(result.visible.map((x) => x.id)).toEqual(["job"]);
    expect(result.counts).toEqual({ all: 1, unread: 1, mentions: 0, system: 1 });
  });
  it("searches the displayed fallback source name", () => {
    expect(
      selectActivityView([item("notice")], { ...defaultActivityView, query: "misty notice" })
        .visible,
    ).toHaveLength(1);
  });
  it("sorts by latest timestamp with deterministic ties", () => {
    expect(selectActivityView(items, defaultActivityView).visible.map((x) => x.id)).toEqual([
      "job",
      "approval",
      "mention",
      "reply",
    ]);
    expect(
      selectActivityView(items, { ...defaultActivityView, sort: "oldest" }).visible.map(
        (x) => x.id,
      ),
    ).toEqual(["approval", "mention", "reply", "job"]);
  });
  it("derives exact eligible footer targets and removes read updates from Unread", () => {
    const result = selectActivityView(items, { ...defaultActivityView, section: "system" });
    expect(result.readableIds).toEqual(["job"]);
    expect(result.clearableIds).toEqual(["job"]);
    expect(result.narrowed).toBe(true);
    const read = items.map((x) => (x.id === "job" ? { ...x, readAt: "today" } : x));
    expect(
      selectActivityView(read, { ...defaultActivityView, section: "unread" }).visible.map(
        (x) => x.id,
      ),
    ).toEqual(["approval", "mention"]);
  });
});
