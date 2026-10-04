import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  setState: vi.fn(),
  state: {
    executionMode: "team",
    working: true,
    accountId: "owner",
    selectedAgentId: "agent",
    error: null,
  },
}));
vi.mock("../agentWindowHandoff", () => ({ showAgentWindow: mocks.show }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("../betaModes", () => ({ visibleAutopilotAvailable: () => true }));
vi.mock("@/features/misty/useMistyStore", () => ({
  useMistyStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    {
      getState: () => mocks.state,
      setState: mocks.setState,
    },
  ),
}));
import { AgentWorkLocation } from "./AgentWorkLocation";
it("keeps an early Show window notice local without interrupting task admission", async () => {
  mocks.show.mockRejectedValue(
    new Error("Agent window: No agent window is open. Start a separate-window task first."),
  );
  render(<AgentWorkLocation />);
  fireEvent.click(screen.getByRole("button", { name: "Show agent window" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("once the task starts"),
  );
  expect(mocks.show).toHaveBeenCalledWith("owner", "agent");
  expect(mocks.setState).not.toHaveBeenCalled();
  expect(mocks.state.error).toBeNull();
});
