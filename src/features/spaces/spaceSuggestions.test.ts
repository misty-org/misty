import { expect, it } from "vitest";
import { spaceItemKeyFromRoute } from "./spaceItemRoute";
import { spaceSuggestions } from "./spaceSuggestions";
import type { SpaceOverviewItem } from "./useSpaceOverview";
it("normalizes content identities while excluding indexes, foreign Spaces, and trash", () => {
  expect(spaceItemKeyFromRoute("/spaces/s/notes?note=n&rename=1", "s")).toBe("note:n");
  expect(spaceItemKeyFromRoute("/spaces/s/social/misty", "s")).toBe("chat:everyone");
  expect(spaceItemKeyFromRoute("/spaces/s/social/discord?conversation=c&message=m", "s")).toBe(
    "chat:c",
  );
  for (const route of [
    "/spaces/s/home",
    "/spaces/s/notes",
    "/spaces/s/planner/tasks/list",
    "/spaces/s/social",
    "/spaces/s/library?item=f&collection=recently-deleted",
    "/spaces/other/notes?note=n",
  ])
    expect(spaceItemKeyFromRoute(route, "s")).toBeUndefined();
});
it("suggests assigned due work, never recent activity", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const item = (id: string, patch: Partial<SpaceOverviewItem> = {}): SpaceOverviewItem => ({
    id,
    title: id,
    kind: "task",
    area: "Planner",
    updatedAt: now.toISOString(),
    route: `/spaces/s/planner?task=${id.split(":")[1]}`,
    ...patch,
  });
  const items = [
    item("task:late", { assigneeUserId: "me", dueAt: "2026-09-30T12:00:00Z" }),
    item("task:other", { assigneeUserId: "other", dueAt: "2026-09-30T12:00:00Z" }),
    item("task:closed", { assigneeUserId: "me", dueAt: "2026-09-30T12:00:00Z", completed: true }),
    item("chat:c", { kind: "chat", area: "Chat", route: "/spaces/s/social/misty?conversation=c" }),
    item("note:n", { kind: "note", area: "Journal" }),
  ];
  expect(spaceSuggestions(items, "me", now).map((r) => [r.item.id, r.reason])).toEqual([
    ["task:late", "Overdue"],
  ]);
  expect(
    spaceSuggestions(
      items.filter((i) => !i.dueAt),
      "me",
      now,
    ),
  ).toEqual([]);
});
