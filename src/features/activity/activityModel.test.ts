import type { SpaceInvitation } from "@/api/spaces/dto/interfaces/types";
import { describe, expect, it } from "vitest";
import {
  activityItemFromInvitation,
  activityKindNeedsAttention,
  activityTargetMatchesLocation,
  formatActivityBadge,
  unreadActivityCountForSpace,
  unreadActivityCountForSpaceSection,
  unreadActivityCountForTool,
} from "./activityModel";
import type { ActivityItem } from "./types";

describe("activityModel", () => {
  it("maps invitations into attention items", () => {
    expect(activityItemFromInvitation("account-1", invitationFixture())).toMatchObject({
      id: "invitation:invite-1",
      kind: "invitation",
      attention: true,
      title: "Sam invited you to Home",
      target: { kind: "space", spaceId: "space-2" },
    });
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
