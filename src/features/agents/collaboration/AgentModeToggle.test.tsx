import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setMode: vi.fn(), setPermissionMode: vi.fn() }));
vi.mock("./api", () => ({
  collaborationApi: { setMode: mocks.setMode, setPermissionMode: mocks.setPermissionMode },
}));
import { AgentModeMenu } from "./AgentModeToggle";
import { useCollaborationStore } from "./store";

beforeEach(() => useCollaborationStore.setState({ byConversation: {}, draftMode: "act" }));
afterEach(cleanup);

it("shows Plan, or the chat's Manual or Auto, on one trigger", () => {
  const { rerender } = render(<AgentModeMenu mode="act" permission="auto" />);
  expect(screen.getByRole("button", { name: "Mode" }).textContent).toContain("Auto");
  rerender(<AgentModeMenu mode="act" permission="ask" />);
  expect(screen.getByRole("button", { name: "Mode" }).textContent).toContain("Manual");
  rerender(<AgentModeMenu mode="plan" permission="auto" />);
  expect(screen.getByRole("button", { name: "Mode" }).textContent).toContain("Plan");
});

it("turns Plan on from the menu", async () => {
  render(<AgentModeMenu mode="act" permission="auto" />);
  await act(async () => fireEvent.keyDown(screen.getByRole("button", { name: "Mode" }), { key: "ArrowDown" }));
  await act(async () => fireEvent.click(await screen.findByRole("menuitemradio", { name: "Plan" })));
  expect(useCollaborationStore.getState().draftMode).toBe("plan");
});
