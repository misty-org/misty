import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("./store/useAgentsStore", () => ({
  agentsDeviceSnapshot: vi.fn(async () => ({
    device: { id: "local", status: "online" },
    scopes: [
      { id: "scope_site", displayName: "site", kind: "project_folder", available: true },
      { id: "scope_blog", displayName: "blog", kind: "project_folder", available: true },
      { id: "scope_docs", displayName: "Docs", kind: "local_folder", available: true },
    ],
  })),
}));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: vi.fn(async () => ({ id: "device_1" })),
}));

import { chatDeviceGrants, desktopDeviceGrants, projectCapabilities } from "./deviceGrants";
import { useConversationProject } from "./store/useConversationProject";

beforeEach(() => vi.clearAllMocks());

const kinds = (contexts: Awaited<ReturnType<typeof desktopDeviceGrants>>) =>
  contexts.map((context) => `${context.kind}:${context.opaqueRef}`);

it("attaches no folder when the chat has no project", async () => {
  expect(kinds(await desktopDeviceGrants(null))).toEqual(["workspace:workspace:device_1"]);
});

it("attaches only the chat's project, for delegated coding", async () => {
  const contexts = await desktopDeviceGrants("scope_site");
  expect(kinds(contexts)).toEqual(["project_folder:scope_site", "workspace:workspace:device_1"]);
  expect(contexts[0]!.capabilities).toEqual(projectCapabilities);
  expect(projectCapabilities).toEqual([
    "folder.list",
    "folder.read",
    "folder.send",
    "code.delegate",
  ]);
  expect(projectCapabilities).toContain("folder.read");
});

it("gives a folder shared read-only before projects only the read-only tools", async () => {
  const contexts = await desktopDeviceGrants("scope_docs");
  expect(kinds(contexts)[0]).toBe("local_folder:scope_docs");
  expect(contexts[0]!.capabilities.some((capability) => capability.startsWith("code."))).toBe(
    false,
  );
});

it("sends a new chat's project and hands the choice to the new conversation", async () => {
  useConversationProject.setState({ byConversation: {}, draft: "scope_blog" });
  const contexts = await chatDeviceGrants("conversation-new", true);
  expect(kinds(contexts)[0]).toBe("project_folder:scope_blog");
  expect(useConversationProject.getState().project("conversation-new")).toBe("scope_blog");
  expect(useConversationProject.getState().draft).toBeNull();
  // A later message in another, project-less conversation sends no folder.
  expect(kinds(await chatDeviceGrants("conversation-other", false))).toEqual([
    "workspace:workspace:device_1",
  ]);
});
