import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMistyActivityPhrase } from "./MistyActivityStatus";

afterEach(() => vi.useRealTimers());

describe("Misty activity phrases", () => {
  it("says Thinking until the run names its step, then honors tool-specific phases", () => {
    const { result, rerender } = renderHook(({ activity }) => useMistyActivityPhrase(activity), {
      initialProps: { activity: undefined as string | undefined },
    });
    expect(result.current).toBe("Thinking");
    rerender({ activity: "using_weather.current" });
    expect(result.current).toBe("Checking the weather");
  });
});
