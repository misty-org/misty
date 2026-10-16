import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cancel: vi.fn(async () => ({})) }));
vi.mock("@/features/ai-surface/api", () => ({ aiSurfaceApi: { cancelInvocation: mocks.cancel } }));
import { AgentNotebookCard } from "./AgentNotebookCard";
import { AgentSubagents } from "./AgentSubagents";

it("shows each sub-agent's progress in words and stops a running one", async () => {
  render(
    <AgentSubagents
      subagents={[
        { invocationId: "inv-a", goal: "Price Acme", state: "running" },
        { invocationId: "inv-b", goal: "Price Globex", state: "completed", summary: "$12 a month" },
        { invocationId: "inv-c", goal: "Price Initech", state: "failed" },
      ]}
    />,
  );
  expect(screen.getByText("Running 1 of 3 helpers")).toBeTruthy();
  expect(screen.getByText("Working")).toBeTruthy();
  expect(screen.getByText("Done")).toBeTruthy();
  expect(screen.getByText("$12 a month")).toBeTruthy();
  expect(screen.getByText("Didn’t finish")).toBeTruthy();
  // Only the running one can be stopped.
  const stops = screen.getAllByRole("button", { name: /Stop sub-agent/ });
  expect(stops).toHaveLength(1);
  await act(async () => fireEvent.click(stops[0]!));
  expect(mocks.cancel).toHaveBeenCalledWith("inv-a");
  expect(screen.getByText("Stopping")).toBeTruthy();
  expect(screen.queryAllByRole("button", { name: /Stop sub-agent/ })).toHaveLength(0);
});

it("shows the notebook's findings open, without the agent's checklist", async () => {
  render(
    <AgentNotebookCard
      notebook={{
        plan: "- [x] Find prices",
        findings: "Acme costs $12 (https://acme.example)",
        noteId: "note_1",
      }}
    />,
  );
  expect(screen.queryByText("Find prices")).toBeNull();
  expect(screen.getByText(/Acme costs \$12/)).toBeTruthy();
  expect(screen.getByText("Also saved as a note in your personal Space.")).toBeTruthy();
  const toggle = screen.getByRole("button", { name: /Notebook/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  await act(async () => fireEvent.click(toggle));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

it("renders nothing for an empty notebook", () => {
  const { container } = render(
    <AgentNotebookCard notebook={{ plan: "- [ ] Only a checklist", findings: " " }} />,
  );
  expect(container.textContent).toBe("");
});
