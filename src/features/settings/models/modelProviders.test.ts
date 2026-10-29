import { describe, expect, it } from "vitest";
import { needsModelKey } from "./ModelKeyNeeded";
import { qualifiedModel } from "./modelProviders";

describe("qualifiedModel", () => {
  it("prefixes a bare model with the selected provider", () => {
    expect(qualifiedModel(" claude-sonnet-5-5 ", "anthropic")).toBe("anthropic/claude-sonnet-5-5");
    expect(qualifiedModel("qwen3:14b", "ollama")).toBe("ollama/qwen3:14b");
  });
  it("keeps a model that already names a provider", () => {
    expect(qualifiedModel("openai/text-embedding-3-small", "anthropic")).toBe(
      "openai/text-embedding-3-small",
    );
  });
  it("treats a nested OpenRouter model path as OpenRouter's", () => {
    expect(qualifiedModel("anthropic/claude-sonnet-5.5", "openrouter")).toBe(
      "openrouter/anthropic/claude-sonnet-5.5",
    );
    expect(qualifiedModel("openrouter/openai/gpt-5.5", "openrouter")).toBe(
      "openrouter/openai/gpt-5.5",
    );
  });
  it("clears an empty value", () => {
    expect(qualifiedModel("  ", "openai")).toBe("");
  });
});

describe("needsModelKey", () => {
  it("recognizes the server's model_key_needed message", () => {
    expect(needsModelKey("Add a model key in Settings → Models.")).toBe(true);
    expect(needsModelKey("Agent request canceled.")).toBe(false);
    expect(needsModelKey(null)).toBe(false);
  });
});
