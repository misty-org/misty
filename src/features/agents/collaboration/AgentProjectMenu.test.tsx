import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  agentsDeviceSnapshot: vi.fn(async () => ({
    scopes: [
      { id: "scope_site", displayName: "site", kind: "project_folder", available: true },
      { id: "scope_docs", displayName: "Docs", kind: "local_folder", available: true },
    ],
  })),
  codeChooseProject: vi.fn(async () => ({ id: "scope_new", displayName: "new" })),
}));
vi.mock("../store/useAgentsStore", () => store);
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));

import { useConversationProject } from "../store/useConversationProject";
import { AgentProjectMenu } from "./AgentProjectMenu";

beforeEach(() => useConversationProject.setState({ byConversation: {}, draft: null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function open() {
  const trigger = await screen.findByRole("button", { name: /Project/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

it("starts with no project and picks one for this conversation", async () => {
  render(<AgentProjectMenu conversationId="conversation-a" />);
  const trigger = await open();
  expect(trigger.textContent).toContain("No project");
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /site/ }));
  expect(useConversationProject.getState().project("conversation-a")).toBe("scope_site");
  expect(useConversationProject.getState().project("conversation-b")).toBeNull();
});

it("adds a project from the menu and picks it", async () => {
  render(<AgentProjectMenu />);
  await open();
  fireEvent.click(await screen.findByRole("menuitem", { name: /Add an existing folder/ }));
  await waitFor(() => expect(useConversationProject.getState().draft).toBe("scope_new"));
});
