import { describe, expect, it } from "vitest";
import { agentOf, chatHref, gitSummary, recentChats, shortPath, waitingRuns } from "./overviewData";

const chat = (id: string, updatedAt: string, agentId?: string) => ({
  id,
  title: `Chat ${id}`,
  agentId,
  updatedAt,
});
const run = (id: string, conversation: string, state: string, at: string, parent = "") => ({
  id,
  state,
  conversation_id: conversation,
  agent_id: "",
  title: `Run ${id}`,
  updated_at: at,
  parent_run_id: parent,
});

describe("Space overview", () => {
  it("lists chats whose latest run is waiting for the person, newest first", () => {
    const chats = [chat("a", "1", "codex"), chat("b", "2"), chat("c", "3")];
    const waiting = waitingRuns(
      [
        run("1", "a", "awaiting_approval", "2026-01-01T10:00:00Z"),
        run("2", "b", "awaiting_intervention", "2026-01-01T11:00:00Z"),
        // A newer run in the same chat means the old question is no longer open.
        run("3", "c", "awaiting_approval", "2026-01-01T09:00:00Z"),
        run("4", "c", "running", "2026-01-01T12:00:00Z"),
        // Another Space's chat, and a delegated run, never show.
        run("5", "elsewhere", "awaiting_approval", "2026-01-01T12:00:00Z"),
        run("6", "a", "awaiting_approval", "2026-01-01T13:00:00Z", "1"),
      ],
      chats,
    );
    expect(waiting.map((item) => item.conversationId)).toEqual(["b", "a"]);
    expect(waiting[0].asks).toBe("Needs your help");
    expect(waiting[1]).toMatchObject({
      agentId: "codex",
      title: "Chat a",
      asks: "Needs your approval",
    });
  });

  it("keeps the five most recently updated chats", () => {
    const chats = ["3", "1", "6", "2", "5", "4"].map((at) => chat(at, `2026-01-0${at}`));
    expect(recentChats(chats).map((item) => item.id)).toEqual(["6", "5", "4", "3", "2"]);
  });

  it("finds a chat's agent, falling back to the built-in one only when it names none", () => {
    const agents = [
      { id: "misty", system_managed: true },
      { id: "codex", system_managed: false },
    ] as Parameters<typeof agentOf>[0];
    expect(agentOf(agents, "codex")?.id).toBe("codex");
    expect(agentOf(agents, undefined)?.id).toBe("misty");
    expect(agentOf(agents, "gone")).toBeUndefined();
  });

  it("addresses a chat on the Agents page", () => {
    expect(chatHref("codex", "c1")).toBe("/agents?agent=codex&conversation=c1");
    expect(chatHref(undefined, "c1")).toBe("/agents?conversation=c1");
    expect(chatHref(undefined, "")).toBe("/agents");
  });

  it("sums up a folder's Git state", () => {
    expect(gitSummary(null)).toBeNull();
    expect(gitSummary({ repository: false, branch: "", changes: [] })).toBeNull();
    expect(
      gitSummary({
        repository: true,
        branch: "main",
        changes: [
          { path: "a.ts", status: "modified", staged: true },
          { path: "a.ts", status: "modified", staged: false },
          { path: "b.ts", status: "untracked", staged: false },
        ],
      }),
    ).toEqual({ branch: "main", changed: 2 });
  });

  it("shortens the home folder in a path", () => {
    expect(shortPath("/Users/sam/code/misty")).toBe("~/code/misty");
    expect(shortPath("/opt/work")).toBe("/opt/work");
  });
});
