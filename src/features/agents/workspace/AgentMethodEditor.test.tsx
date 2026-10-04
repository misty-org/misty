import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AgentMethodEditor, AgentMethodInputFields, blankDefinition } from "./AgentMethodEditor";
import type { AgentMethod, AgentMethodInputs } from "@/api/ai/agent-methods";

const method: AgentMethod = {
  id: "method",
  agent_id: "agent",
  kind: "workflow",
  enabled: true,
  version: 3,
  version_id: "version3",
  updated_at: "2026-10-03",
  definition: { ...blankDefinition(), title: "Brief", instructions: "Summarize the source." },
};
describe("saved method editor", () => {
  it("pins an edit to its expected version and preserves the draft on conflict", async () => {
    const onSave = vi.fn().mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    const onClose = vi.fn();
    render(
      <AgentMethodEditor
        agentId="agent"
        kind="workflow"
        method={method}
        sources={[]}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Keep this new draft." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save workflow" }));
    await screen.findByRole("alert");
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "method",
        expected_version: 3,
        definition: expect.objectContaining({ instructions: "Keep this new draft." }),
      }),
    );
    expect((screen.getByLabelText("Instructions") as HTMLTextAreaElement).value).toBe(
      "Keep this new draft.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
  it("adding an input does not submit the editor", () => {
    const onSave = vi.fn();
    render(
      <AgentMethodEditor
        agentId="agent"
        kind="workflow"
        method={method}
        sources={[]}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add input" }));
    expect(screen.getByLabelText("Input 1 question")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("saves tool prerequisites as separate names rather than granting permissions", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentMethodEditor
        agentId="agent"
        kind="workflow"
        method={method}
        sources={[]}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Required tools"), {
      target: { value: "calendar.list, misty.search" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save workflow" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          definition: expect.objectContaining({
            required_tools: ["calendar.list", "misty.search"],
          }),
        }),
      ),
    );
  });
});
it("typed questions preserve numeric values and omit cleared answers", () => {
  function Fields() {
    const [values, setValues] = useState<AgentMethodInputs>({});
    return (
      <>
        <AgentMethodInputFields
          fields={[{ key: "count", label: "How many?", type: "number", required: true }]}
          values={values}
          onChange={setValues}
        />
        <output>{JSON.stringify(values)}</output>
      </>
    );
  }
  render(<Fields />);
  fireEvent.change(screen.getByLabelText("How many?"), { target: { value: "0" } });
  expect(screen.getByRole("status").textContent).toBe('{"count":0}');
  fireEvent.change(screen.getByLabelText("How many?"), { target: { value: "" } });
  expect(screen.getByRole("status").textContent).toBe("{}");
});

afterEach(cleanup);
