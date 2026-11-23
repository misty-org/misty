import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/platform/native_invoke", () => ({ invoke: vi.fn() }));

import { tutorStatus } from "./TutorSettings";

describe("Tutor's status line", () => {
  const base = { ready: true, on: true, phase: "idle", talkKeys: "⌃ ⌥" };
  it("says what Tutor is doing", () => {
    expect(tutorStatus({ ...base, ready: undefined })).toBe("");
    expect(tutorStatus({ ...base, ready: false })).toMatch(/^Needs a default engine/);
    expect(tutorStatus({ ...base, on: false })).toMatch(/^Off/);
    expect(tutorStatus({ ...base, phase: "listening" })).toBe("Listening");
    expect(tutorStatus(base)).toBe("Ready. Hold ⌃ ⌥ anywhere to talk.");
  });
});
