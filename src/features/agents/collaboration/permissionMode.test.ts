import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setPermissionMode: vi.fn() }));
vi.mock("./api", () => ({ collaborationApi: { setPermissionMode: mocks.setPermissionMode } }));
import { effectivePermissionMode, setPermissionMode } from "./permissionMode";
import { useCollaborationStore } from "./store";
import type { ConversationCollaboration } from "./types";

const conversation = (
  overrides: Partial<ConversationCollaboration> = {},
): ConversationCollaboration => ({
  mode: "act",
  permissionMode: "",
  agentPermissionMode: "auto",
  plan: null,
  planHistory: [],
  goal: null,
  questionSets: [],
  runningInvocationId: "",
  ...overrides,
});

beforeEach(() => {
  mocks.setPermissionMode.mockReset();
  useCollaborationStore.setState({ byConversation: {}, draftPermissionMode: "", error: "" });
});

it("follows the chat, then its agent, then Ask", () => {
  expect(effectivePermissionMode(conversation({ permissionMode: "ask" }), "")).toBe("ask");
  expect(effectivePermissionMode(conversation(), "")).toBe("auto");
  expect(effectivePermissionMode(undefined, "", "auto")).toBe("auto");
  expect(effectivePermissionMode(undefined, "ask", "auto")).toBe("ask");
  expect(effectivePermissionMode(undefined, "")).toBe("ask");
});

it("keeps a new chat's choice as a draft until the chat exists", async () => {
  await setPermissionMode(undefined, "auto");
  expect(useCollaborationStore.getState().draftPermissionMode).toBe("auto");
  expect(mocks.setPermissionMode).not.toHaveBeenCalled();
});

it("saves a chat's choice and rolls back when the server refuses", async () => {
  useCollaborationStore.setState({ byConversation: { c1: conversation() } });
  mocks.setPermissionMode.mockResolvedValueOnce({ permissionMode: "ask" });
  await setPermissionMode("c1", "ask");
  expect(mocks.setPermissionMode).toHaveBeenCalledWith("c1", "ask");
  expect(useCollaborationStore.getState().byConversation.c1?.permissionMode).toBe("ask");
  mocks.setPermissionMode.mockRejectedValueOnce(new Error("nope"));
  await setPermissionMode("c1", "auto");
  expect(useCollaborationStore.getState().byConversation.c1?.permissionMode).toBe("ask");
  expect(useCollaborationStore.getState().error).toMatch(/couldn't change Ask or Auto/);
});
