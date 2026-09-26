import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentProfile } from "@/shared/contracts";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { MistyAgentPicker } from "./MistyAgentPicker";
vi.mock("@/api/accountEvents", () => ({ observeAccountChanges: () => () => {} }));
vi.mock("@/features/agents/localExecution", () => ({
  finishLocalExecution: vi.fn(),
  useLocalExecution: Object.assign((select: (state: { execution: null }) => unknown) => select({ execution: null }), {
    getState: () => ({ execution: null }),
  }),
}));
const agents = [
  { id: "misty", name: "Misty", enabled: true, system_managed: true, avatar: {} },
  { id: "editor", name: "Editor", enabled: true, system_managed: false, avatar: {} },
  { id: "disabled", name: "Disabled agent", enabled: false, avatar: {} },
] as AgentProfile[];
beforeEach(() => {
  useMistyStore.setState({
    accountId: "account",
    selectedAgentId: "misty",
    working: false,
    query: "My draft",
    activeConversationId: "old",
    context: [{ id: "old-context", kind: "note", title: "Old", source: "current" }],
  });
  usePersonalAgentsStore.setState({
    accountId: "account",
    agents,
    selected: {},
    loading: false,
    error: "",
  });
});
afterEach(cleanup);
it("switches identity without carrying the previous agent’s conversation or losing the draft", async () => {
  render(<MistyAgentPicker accountId="account" />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Agent: Misty" }), {
    button: 0,
    pointerType: "mouse",
  });
  expect(screen.queryByRole("menuitem", { name: "Disabled agent" })).toBeNull();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Editor" }));
  await waitFor(() =>
    expect(useMistyStore.getState()).toMatchObject({
      selectedAgentId: "editor",
      activeConversationId: "",
      context: [],
      query: "My draft",
    }),
  );
  expect(usePersonalAgentsStore.getState().selected.global).toBe("editor");
});
it("keeps the running turn’s identity fixed", () => {
  useMistyStore.setState({ working: true });
  render(<MistyAgentPicker accountId="account" />);
  expect(screen.getByRole("button", { name: "Agent: Misty" })).toHaveProperty("disabled", true);
});
