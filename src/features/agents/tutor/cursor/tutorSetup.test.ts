import { describe, expect, it, vi } from "vitest";

vi.mock("@/native/invoke", () => ({ invoke: vi.fn() }));

import { providerOf, tutorModel } from "./tutorSetup";
import { tutorStatus } from "./TutorSettings";

describe("Tutor setup", () => {
  it("reads the provider from a model ID", () => {
    expect(providerOf("anthropic/claude-haiku-5-5")).toBe("anthropic");
    expect(providerOf("")).toBe("");
  });

  it("is ready when the Tutor model, else the main model, has a key or needs none", () => {
    expect(tutorModel("google/gemini-flash", "anthropic/claude", ["google"]).ready).toBe(true);
    expect(tutorModel("", "anthropic/claude", ["anthropic"])).toEqual({
      model: "anthropic/claude",
      provider: "anthropic",
      ready: true,
    });
    expect(tutorModel("google/gemini-flash", "anthropic/claude", ["anthropic"]).ready).toBe(false);
    expect(tutorModel("ollama/qwen3:4b", "", []).ready).toBe(true);
    expect(tutorModel("", "", ["anthropic"]).ready).toBe(false);
    expect(tutorModel("nobody/model", "", ["nobody"]).ready).toBe(false);
  });
});

describe("Tutor's status line", () => {
  const base = { ready: true, on: true, phase: "idle", talkKeys: "⌃ ⌥" };
  it("says what Tutor is doing", () => {
    expect(tutorStatus({ ...base, ready: undefined })).toBe("");
    expect(tutorStatus({ ...base, ready: false })).toMatch(/^Needs setup/);
    expect(tutorStatus({ ...base, on: false })).toMatch(/^Off/);
    expect(tutorStatus({ ...base, phase: "listening" })).toBe("Listening");
    expect(tutorStatus(base)).toBe("Ready. Hold ⌃ ⌥ anywhere to talk.");
  });
});
