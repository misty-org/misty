import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import { assistantApi } from "@/api/assistant/api";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MistyModelPicker } from "./MistyModelPicker";
initializeHostAgentsRuntime();
beforeEach(() => {
  vi.spyOn(assistantApi, "frontierModels");
  vi.spyOn(assistantApi, "updateConversationSettings").mockResolvedValue({
    id: "conversation",
    model_id: "openai/gpt-6-astra",
    reasoning_effort: "xhigh",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("exposes only two thinking presets and lets the server choose the model", async () => {
  const onChange = vi.fn();
  render(
    <MistyModelPicker
      inline
      conversationId="conversation"
      modelId="legacy-model"
      reasoningEffort="low"
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByText("legacy-model")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Deep thinking" }));
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith({
      modelId: "openai/gpt-6-astra",
      reasoningEffort: "xhigh",
    }),
  );
  expect(assistantApi.updateConversationSettings).toHaveBeenCalledWith("conversation", {
    thinking_mode: "deep",
  });
  expect(assistantApi.frontierModels).not.toHaveBeenCalled();
});
it("changes a new draft without a remote conversation", async () => {
  const onChange = vi.fn();
  render(<MistyModelPicker inline reasoningEffort="xhigh" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Normal" }));
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith({ modelId: "", reasoningEffort: "high" }),
  );
  expect(assistantApi.updateConversationSettings).not.toHaveBeenCalled();
});
it("retains the selected mode and reports a failed save", async () => {
  vi.mocked(assistantApi.updateConversationSettings).mockRejectedValue(new Error("Save failed"));
  const onChange = vi.fn();
  render(
    <MistyModelPicker
      inline
      conversationId="conversation"
      reasoningEffort="high"
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Deep thinking" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Save failed");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("true");
});
