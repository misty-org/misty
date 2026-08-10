import type { SpaceInboxItem, SpaceInvitation } from "@/services/spaces/dto/interfaces/types";
import { describe, expect, it } from "vitest";
import {
  activityItemsFromSpaces,
  activityKindNeedsAttention,
  activityTargetMatchesLocation,
  formatActivityBadge,
  unreadActivityCountForSpace,
  unreadActivityCountForSpaceSection,
  unreadActivityCountForTool,
} from "../activityModel";
import type { ActivityItem } from "../types";

describe("activityModel", () => {
  it("normalizes, deduplicates, and sorts Spaces activity", () => {
    const older = inboxItem({ id: 1, kind: "unread", created_at: "2026-08-07T10:00:00Z" });
    const mention = inboxItem({
      id: 2,
      kind: "mention",
      created_at: "2026-08-08T10:00:00Z",
      payload: { sender_name: "Alex", preview: "Can you review this?" },
    });
    const items = activityItemsFromSpaces(
      "account-1",
      { unreads: [older, mention], mentions: [mention] },
      [invitationFixture()],
    );

    expect(items.map((item) => item.id)).toEqual(["invitation:invite-1", "spaces:2", "spaces:1"]);
    expect(items[1]).toMatchObject({
      kind: "mention",
      attention: true,
      title: "Alex mentioned you in Studio",
      target: { kind: "space-chat", spaceId: "space-1", messageId: "message-2" },
    });
    expect(items[2].attention).toBe(false);
  });

  it("maps replies, approvals, and failures into attention categories", () => {
    const items = activityItemsFromSpaces(
      "account-1",
      {
        unreads: [
          inboxItem({ id: 1, payload: { is_reply: true } }),
          inboxItem({ id: 2, kind: "approval" }),
          inboxItem({ id: 3, kind: "workflow", payload: { status: "failed" } }),
        ],
        mentions: [],
      },
      [],
    );

    expect(items.map((item) => item.kind).sort()).toEqual(["approval", "failure", "reply"]);
    expect(items.every((item) => item.attention)).toBe(true);
    expect(activityKindNeedsAttention("message")).toBe(false);
    expect(activityKindNeedsAttention("reminder")).toBe(true);
  });

  it("formats visible badges without losing the full underlying count", () => {
    expect(formatActivityBadge(0)).toBe("0");
    expect(formatActivityBadge(99)).toBe("99");
    expect(formatActivityBadge(100)).toBe("99+");
  });

  it("scopes unread counts to the destination that owns them", () => {
    const items: ActivityItem[] = [
      activityFixture("chat", { kind: "space-chat", spaceId: "space-1" }),
      activityFixture("task", { kind: "space-task", spaceId: "space-1", taskId: "task-1" }),
      activityFixture("files", { kind: "workspace-tool", tool: "files" }),
      activityFixture(
        "read-chat",
        { kind: "space-chat", spaceId: "space-1" },
        "2026-08-08T13:00:00Z",
      ),
    ];

    expect(unreadActivityCountForSpace(items, "space-1")).toBe(2);
    expect(unreadActivityCountForSpaceSection(items, "space-1", "chat")).toBe(1);
    expect(unreadActivityCountForSpaceSection(items, "space-1", "planner")).toBe(1);
    expect(unreadActivityCountForTool(items, "files")).toBe(1);
  });

  it("recognizes when the user has reached an event's owning surface", () => {
    expect(
      activityTargetMatchesLocation(
        { kind: "space-chat", spaceId: "space/one" },
        "/spaces/space%2Fone/chat",
      ),
    ).toBe(true);
    expect(
      activityTargetMatchesLocation(
        { kind: "space-task", spaceId: "space-1", taskId: "task-1" },
        "/spaces/space-1/chat",
      ),
    ).toBe(false);
    expect(
      activityTargetMatchesLocation({ kind: "workspace-tool", tool: "agents" }, "/agents"),
    ).toBe(true);
  });
});

function activityFixture(
  id: string,
  target: ActivityItem["target"],
  readAt?: string,
): ActivityItem {
  return {
    id,
    accountId: "account-1",
    source: "device",
    sourceId: id,
    kind: "system",
    title: id,
    body: "",
    createdAt: "2026-08-08T12:00:00Z",
    attention: false,
    target,
    ...(readAt ? { readAt } : {}),
  };
}

function inboxItem(overrides: Partial<SpaceInboxItem> = {}): SpaceInboxItem {
  const id = overrides.id ?? 1;
  return {
    id,
    space_id: "space-1",
    space_name: "Studio",
    kind: "unread",
    message_id: `message-${id}`,
    payload: {},
    created_at: "2026-08-08T09:00:00Z",
    ...overrides,
  };
}

function invitationFixture(): SpaceInvitation {
  return {
    id: "invite-1",
    space_id: "space-2",
    space_name: "Home",
    invited_email: "test@example.com",
    invited_by_user_id: "user-2",
    inviter_name: "Sam",
    delivery_status: "sent",
    expires_at: "2026-08-10T12:00:00Z",
    created_at: "2026-08-08T12:00:00Z",
  };
}
