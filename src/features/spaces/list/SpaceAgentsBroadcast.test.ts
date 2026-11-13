import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/agents", () => ({}));
vi.mock("../components/space-row/useWindowSpace", () => ({}));
vi.mock("../overview/useSpaceItemCreator", () => ({}));
vi.mock("./createSpacesRealtimeActions", () => ({}));

const { spaceAgentStatuses } = await import("./SpaceAgentsBroadcast");

const agent = (
  id: string,
  state: "working" | "needs-you" | "resting",
  conversationId: string,
  files: string[] = [],
) => ({ agent: { id, name: id }, state, doingCode: "shell", files, conversationId });

describe("spaceAgentStatuses", () => {
  const chats = [
    { id: "here", spaceId: "space-a" },
    { id: "elsewhere", spaceId: "space-b" },
  ];

  it("tells a Space only about work on its own chats", () => {
    const statuses = spaceAgentStatuses(
      [
        agent("builder", "working", "here", ["src/app.ts"]),
        agent("writer", "working", "elsewhere", ["secret/plan.md"]),
        agent("asker", "needs-you", "elsewhere"),
        agent("idle", "resting", ""),
      ],
      "space-a",
      chats,
    );
    expect(statuses).toEqual([
      { id: "builder", name: "builder", state: "working", doing: "shell", files: ["src/app.ts"] },
      { id: "writer", name: "writer", state: "resting", doing: "" },
      { id: "asker", name: "asker", state: "resting", doing: "" },
      { id: "idle", name: "idle", state: "resting", doing: "" },
    ]);
  });

  it("treats a chat it doesn't know yet as elsewhere", () => {
    expect(spaceAgentStatuses([agent("x", "working", "unknown")], "space-a", chats)[0]).toEqual({
      id: "x",
      name: "x",
      state: "resting",
      doing: "",
    });
  });
});
