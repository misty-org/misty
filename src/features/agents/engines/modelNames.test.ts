import { describe, expect, it } from "vitest";
import { modelName, rememberModelNames } from "./modelNames";

describe("a model's name", () => {
  it("is the name the engine gives, never rewritten", () => {
    expect(modelName("Opus 5.5", "opus")).toBe("Opus 5.5");
    expect(modelName("GPT-5.6-Terra", "gpt-5.6-terra")).toBe("GPT-5.6-Terra");
  });

  it("is the id as the engine wrote it when the engine names it nowhere", () => {
    expect(modelName("", "anthropic/claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
    expect(modelName("gpt-6.1-sol", "gpt-6.1-sol")).toBe("gpt-6.1-sol");
  });

  it("is the catalog's name for an id seen elsewhere, such as a reply's model", () => {
    rememberModelNames([{ id: "claude-opus-5-5", label: "Opus 5.5" }]);
    expect(modelName("claude-opus-5-5", "claude-opus-5-5")).toBe("Opus 5.5");
  });
});
