import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "@/shared/schemas";
import { usePersonalAgentsStore } from "../../../personal/personalAgentsStore";
import { sessionsByFolder } from "./engineHistory";
import { agentForPastChat, usePastChatAsk } from "./pastChats";

const folders: { agent: string; path: string }[] = [];

vi.mock("@/native/invoke", () => ({
  invoke: async (command: string) => {
    if (command === "agent_folder_list") return folders;
    throw new Error(`unexpected ${command}`);
  },
}));

const agent = (id: string, engine: string) => ({ id, engine }) as AgentProfile;
const chat = { engine: "codex", sessionId: "s1", workspacePath: "/Users/me/app", title: "Fix it" };

beforeEach(() => {
  folders.length = 0;
  usePastChatAsk.setState({ asking: undefined });
  usePersonalAgentsStore.setState({
    agents: [agent("claude-1", "claude"), agent("codex-1", "codex"), agent("codex-2", "codex")],
  });
});

describe("agentForPastChat", () => {
  it("continues with the agent on the chat's engine that works in its folder", async () => {
    folders.push({ agent: "claude-1", path: chat.workspacePath });
    folders.push({ agent: "codex-2", path: chat.workspacePath });
    await expect(agentForPastChat(chat, "codex-1")).resolves.toEqual({
      agentId: "codex-2",
      folder: chat.workspacePath,
    });
    expect(usePastChatAsk.getState().asking).toBeUndefined();
  });

  it("asks which agent gets a folder no agent on its engine works in", async () => {
    folders.push({ agent: "claude-1", path: chat.workspacePath });
    const answer = agentForPastChat(chat, "codex-1");
    await vi.waitFor(() => expect(usePastChatAsk.getState().asking?.chat).toEqual(chat));
    expect(usePastChatAsk.getState().asking?.preferred).toBe("codex-1");
    usePastChatAsk.getState().asking?.answer({ agentId: "codex-1", folder: "/Users/me/app" });
    await expect(answer).resolves.toEqual({ agentId: "codex-1", folder: "/Users/me/app" });
    expect(usePastChatAsk.getState().asking).toBeUndefined();
  });

  it("gives nothing when the person cancels", async () => {
    const answer = agentForPastChat(chat);
    await vi.waitFor(() => expect(usePastChatAsk.getState().asking).toBeDefined());
    usePastChatAsk.getState().asking?.answer(null);
    await expect(answer).resolves.toBeNull();
  });
});

describe("sessionsByFolder", () => {
  it("groups by folder, the folder with the newest chat first", () => {
    const groups = sessionsByFolder([
      { workspacePath: "/a", updatedAt: 1, id: 1 },
      { workspacePath: "/b", updatedAt: 5, id: 2 },
      { workspacePath: "/a", updatedAt: 3, id: 3 },
    ]);
    expect(groups.map((group) => [group.path, group.sessions.map((s) => s.id)])).toEqual([
      ["/b", [2]],
      ["/a", [3, 1]],
    ]);
  });
});
