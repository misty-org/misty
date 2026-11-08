import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
const adoptFolderChanges = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./useAgentsStore", () => ({
  adoptFolderChanges,
  stopFolderChanges: vi.fn(async () => undefined),
  agentsDeviceSnapshot: vi.fn(async () => ({
    device: { id: "local", status: "online" },
    scopes: [
      { id: "scope_docs", displayName: "Docs", kind: "local_folder", available: true },
      { id: "scope_blog", displayName: "blog", kind: "local_folder", available: true },
    ],
  })),
}));
vi.mock("./useAgentDeviceStore", () => ({
  ensureAgentDevice: vi.fn(async () => ({ id: "device_1" })),
}));

import { chatDeviceGrants, desktopDeviceGrants } from "./deviceGrants";
import { useConversationFolder } from "../shared-folders/useConversationFolder";

beforeEach(() => vi.clearAllMocks());

const kinds = (contexts: Awaited<ReturnType<typeof desktopDeviceGrants>>) =>
  contexts.map((context) => `${context.kind}:${context.opaqueRef}`);

it("attaches no folder when the chat has none", async () => {
  expect(kinds(await desktopDeviceGrants(null))).toEqual(["workspace:workspace:device_1"]);
});

it("attaches only the chat's folder, with the read-only tools", async () => {
  const contexts = await desktopDeviceGrants("scope_docs");
  expect(kinds(contexts)).toEqual(["local_folder:scope_docs", "workspace:workspace:device_1"]);
  expect(contexts[0]!.capabilities).toEqual(["folder.list", "folder.read", "folder.send"]);
});

it("adds write access only when the chat granted it", async () => {
  const contexts = await desktopDeviceGrants("scope_docs", true);
  expect(contexts[0]!.capabilities).toContain("folder.write");
});

it("gives the shell to the workspace grant, never to a folder", async () => {
  const contexts = await desktopDeviceGrants("scope_docs");
  expect(contexts[0]!.capabilities).not.toContain("shell.run");
  expect(contexts[1]!.capabilities).toContain("shell.run");
});

it("sends a new chat's folder and hands the choice to the new conversation", async () => {
  useConversationFolder.setState({ byConversation: {}, draft: "scope_blog" });
  const contexts = await chatDeviceGrants("conversation-new", true);
  expect(kinds(contexts)[0]).toBe("local_folder:scope_blog");
  expect(useConversationFolder.getState().folder("conversation-new")).toBe("scope_blog");
  expect(useConversationFolder.getState().draft).toBeNull();
  expect(adoptFolderChanges).toHaveBeenCalledWith("draft", "conversation-new");
  // A later message in another conversation with no folder sends none.
  expect(kinds(await chatDeviceGrants("conversation-other", false))).toEqual([
    "workspace:workspace:device_1",
  ]);
});
