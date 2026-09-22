import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setMode: vi.fn(), setPermissionMode: vi.fn() }));
vi.mock("./api", () => ({
  collaborationApi: { setMode: mocks.setMode, setPermissionMode: mocks.setPermissionMode },
}));
import { AgentModeToggle, AgentPermissionMenu } from "./AgentModeToggle";
import { useCollaborationStore } from "./store";

beforeEach(() => useCollaborationStore.setState({ byConversation: {}, draftMode: "act" }));
afterEach(cleanup);

it("turns Plan on and off; there is no Act choice", async () => {
  render(<AgentModeToggle mode="act" />);
  const plan = screen.getByRole("button", { name: "Plan" });
  expect(plan.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByText("Act")).toBeNull();
  await act(async () => fireEvent.click(plan));
  expect(useCollaborationStore.getState().draftMode).toBe("plan");
});

it("shows the chat's Ask or Auto on its menu", () => {
  render(<AgentPermissionMenu permission="auto" />);
  const trigger = screen.getByRole("button", { name: /Permissions/ });
  expect(trigger.textContent).toContain("Auto");
});
