import { expect, it } from "vitest";
import { spaceItemKeyFromRoute } from "./spaceItemRoute";
import { spaceSuggestions } from "./spaceSuggestions";
import type { SpaceOverviewItem } from "./useSpaceOverview";
import type { ActivityItem } from "@/features/activity/types";
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
it("orders assigned due work, unread mentions and explicit requests, never recent activity", () => {
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
  const signal = (id: string, patch: Partial<ActivityItem>): ActivityItem => ({
    id,
    accountId: "me",
    spaceId: "s",
    source: "spaces",
    sourceId: id,
    kind: "mention",
    title: id,
    body: "",
    createdAt: now.toISOString(),
    attention: true,
    target: { kind: "space-chat", spaceId: "s", conversationId: "c", messageId: "m" },
    ...patch,
  });
  const activity = [
    signal("mention", {}),
    signal("request", {
      lifecycle: "request",
      kind: "approval",
      target: { kind: "route", href: "/spaces/s/notes?note=n" },
    }),
    signal("foreign", { accountId: "other" }),
  ];
  const result = spaceSuggestions(items, activity, "me", "s", now);
  expect(result.map((r) => [r.item.id, r.reason])).toEqual([
    ["task:late", "Overdue"],
    ["chat:c", "You were mentioned"],
    ["note:n", "Response requested"],
  ]);
  expect(result[1].route).toContain("&message=m");
  expect(
    spaceSuggestions(
      items.filter((i) => !i.dueAt),
      [signal("read", { readAt: now.toISOString() })],
      "me",
      "s",
      now,
    ),
  ).toEqual([]);
});
