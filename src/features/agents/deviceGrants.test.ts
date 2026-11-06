import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("./store/useAgentsStore", () => ({
  agentsDeviceSnapshot: vi.fn(async () => ({
    device: { id: "local", status: "online" },
    scopes: [
      { id: "scope_docs", displayName: "Docs", kind: "local_folder", available: true },
      { id: "scope_blog", displayName: "blog", kind: "local_folder", available: true },
    ],
  })),
}));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: vi.fn(async () => ({ id: "device_1" })),
}));

import { chatDeviceGrants, desktopDeviceGrants } from "./deviceGrants";
import { useConversationFolder } from "./store/useConversationFolder";

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

it("sends a new chat's folder and hands the choice to the new conversation", async () => {
  useConversationFolder.setState({ byConversation: {}, draft: "scope_blog" });
  const contexts = await chatDeviceGrants("conversation-new", true);
  expect(kinds(contexts)[0]).toBe("local_folder:scope_blog");
  expect(useConversationFolder.getState().folder("conversation-new")).toBe("scope_blog");
  expect(useConversationFolder.getState().draft).toBeNull();
  // A later message in another conversation with no folder sends none.
  expect(kinds(await chatDeviceGrants("conversation-other", false))).toEqual([
    "workspace:workspace:device_1",
  ]);
});
