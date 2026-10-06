import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as CodingTools from "./codingTools";

const access = vi.hoisted(() => ({ included: false as boolean | null }));
vi.mock("./useCodingIncluded", () => ({ useCodingIncluded: () => access.included }));
const account = vi.hoisted(() => ({ openAccountSettingsInBrowser: vi.fn(async () => undefined) }));
vi.mock("@/features/account/openAccountSettings", () => account);
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
const store = vi.hoisted(() => ({
  agentsDeviceSnapshot: vi.fn(async () => ({
    scopes: [{ id: "scope_site", displayName: "site", kind: "project_folder", available: true }],
  })),
  chooseProject: vi.fn(),
}));
vi.mock("../store/useAgentsStore", () => store);
vi.mock("../store/projectGitHub", () => ({ projectRemote: vi.fn(async () => null) }));
vi.mock("./codingTools", async (actual) => ({
  ...(await actual<typeof CodingTools>()),
  detectCodingTools: vi.fn(async () => []),
}));

import { AgentCodingToolMenu } from "../collaboration/AgentCodingToolMenu";
import { AgentProjectMenu } from "../collaboration/AgentProjectMenu";
import { useConversationProject } from "../store/useConversationProject";

beforeEach(() => {
  access.included = false;
  useConversationProject.setState({ byConversation: {}, draft: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function open(name: RegExp) {
  fireEvent.pointerDown(await screen.findByRole("button", { name }), { button: 0, ctrlKey: false });
}

it("shows the upgrade note instead of coding tools on plans without coding", async () => {
  render(<AgentCodingToolMenu conversationId="c1" />);
  await open(/Code/);
  expect(await screen.findByText(/Coding is part of Misty Pro and above/)).toBeTruthy();
  expect(screen.queryByRole("menuitemradio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
  expect(account.openAccountSettingsInBrowser).toHaveBeenCalledWith("/settings/billing");
});

it("shows the upgrade note instead of projects, and drops a chosen project", async () => {
  useConversationProject.setState({ byConversation: { c1: "scope_site" }, draft: null });
  render(<AgentProjectMenu conversationId="c1" />);
  await waitFor(() => expect(useConversationProject.getState().project("c1")).toBeNull());
  await open(/Project/);
  expect(await screen.findByText(/Coding is part of Misty Pro and above/)).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: /New project/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Upgrade" })).toBeTruthy();
  expect(store.agentsDeviceSnapshot).not.toHaveBeenCalled();
});

it("keeps the working menus on plans with coding", async () => {
  access.included = true;
  render(<AgentProjectMenu conversationId="c1" />);
  await open(/Project/);
  expect(await screen.findByRole("menuitem", { name: /New project/ })).toBeTruthy();
  expect(screen.queryByText(/Coding is part of Misty Pro and above/)).toBeNull();
});
