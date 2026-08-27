import { assistantApi, type FrontierModelCatalog } from "@/api/assistant/api";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MistyModelPicker } from "./MistyModelPicker";

afterEach(cleanup);

const mockCatalog: FrontierModelCatalog = {
  catalog_version: "1",
  default_model_id: "claude-sonnet",
  models: [
    {
      id: "claude-sonnet",
      name: "Claude Sonnet 5",
      provider_id: "anthropic",
      provider_name: "Anthropic",
      capabilities: ["chat"],
      reasoning_levels: ["default", "low", "medium", "high"],
    },
    {
      id: "claude-opus",
      name: "Claude Opus 5",
      provider_id: "anthropic",
      provider_name: "Anthropic",
      capabilities: ["chat"],
      reasoning_levels: ["default"],
    },
    {
      id: "gpt-4o",
      name: "GPT-4o",
      provider_id: "openai",
      provider_name: "OpenAI",
      capabilities: ["chat"],
      reasoning_levels: ["default"],
    },
  ],
};

describe("MistyModelPicker", () => {
  beforeEach(() => {
    vi.spyOn(assistantApi, "frontierModels").mockResolvedValue(mockCatalog);
    vi.spyOn(assistantApi, "updateConversationSettings").mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows separate Model and Effort settings and updates the selected model", async () => {
    const onChange = vi.fn();
    render(
      <MistyModelPicker
        conversationId="conv-1"
        modelId="claude-sonnet"
        reasoningEffort="high"
        onChange={onChange}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "Model settings: Claude Sonnet 5 High",
    });

    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });

    expect(await screen.findByText("Model settings")).toBeDefined();
    const modelSetting = screen.getByRole("menuitem", { name: /ModelClaude Sonnet 5/ });
    expect(screen.getByRole("menuitem", { name: /EffortHigh/ })).toBeDefined();

    fireEvent.keyDown(modelSetting, { key: "ArrowRight" });
    expect(await screen.findByText("Anthropic")).toBeDefined();
    expect(screen.getByText("OpenAI")).toBeDefined();
    expect(screen.getByText("Claude Opus 5")).toBeDefined();

    fireEvent.click(screen.getByText("GPT-4o"));

    await waitFor(() => {
      expect(assistantApi.updateConversationSettings).toHaveBeenCalledWith("conv-1", {
        model_id: "gpt-4o",
        reasoning_effort: "",
      });
      expect(onChange).toHaveBeenCalledWith({
        modelId: "gpt-4o",
        reasoningEffort: "",
      });
    });
  });

  it("shows supported effort choices in their own menu", async () => {
    const onChange = vi.fn();
    render(
      <MistyModelPicker
        conversationId="conv-1"
        modelId="claude-sonnet"
        reasoningEffort="high"
        onChange={onChange}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "Model settings: Claude Sonnet 5 High",
    });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });

    const effortSetting = await screen.findByRole("menuitem", { name: /EffortHigh/ });
    fireEvent.keyDown(effortSetting, { key: "ArrowRight" });

    expect(await screen.findByText("More careful reasoning for complex work.")).toBeDefined();
    fireEvent.click(screen.getByText("Light"));

    await waitFor(() => {
      expect(assistantApi.updateConversationSettings).toHaveBeenCalledWith("conv-1", {
        model_id: "claude-sonnet",
        reasoning_effort: "low",
      });
      expect(onChange).toHaveBeenCalledWith({
        modelId: "claude-sonnet",
        reasoningEffort: "low",
      });
    });
  });
});
