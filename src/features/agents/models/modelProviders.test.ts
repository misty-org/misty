import { describe, expect, it } from "vitest";
import { needsModelKey } from "./ModelKeyNeeded";
import {
  defaultAgentModel,
  modelSuggestions,
  providerById,
  qualifiedModel,
} from "./modelProviders";

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

describe("models a provider listed", () => {
  const listed = [
    { id: "openai/text-embedding-3-small", embedding: true },
    { id: "openai/gpt-4.1", embedding: false },
    { id: "openai/gpt-5.5", embedding: false },
  ];
  it("picks Misty's suggestion when the provider offers it, else its first chat model", () => {
    expect(defaultAgentModel("openai", listed)).toBe("openai/gpt-5.5");
    expect(defaultAgentModel("openai", listed.slice(0, 2))).toBe("openai/gpt-4.1");
    expect(defaultAgentModel("chatgpt", [{ id: "chatgpt/gpt-6.1-sol", embedding: false }])).toBe(
      "chatgpt/gpt-6.1-sol",
    );
    expect(defaultAgentModel("openai", [])).toBe("");
  });
  it("suggests the listed models for each role, and Misty's own before a list", () => {
    const openai = providerById("openai")!;
    expect(modelSuggestions(openai, "embedding", listed)).toEqual([
      "openai/text-embedding-3-small",
    ]);
    expect(modelSuggestions(openai, "agent", listed)).toEqual(["openai/gpt-4.1", "openai/gpt-5.5"]);
    expect(modelSuggestions(openai, "agent", null)).toEqual([
      "openai/gpt-5.5",
      "openai/gpt-5.5-mini",
    ]);
  });
  it("names ChatGPT and Ollama Cloud models as their own", () => {
    expect(qualifiedModel("gpt-oss:120b", "ollama-cloud")).toBe("ollama-cloud/gpt-oss:120b");
    expect(qualifiedModel("chatgpt/gpt-6.1-sol", "openai")).toBe("chatgpt/gpt-6.1-sol");
  });
});
