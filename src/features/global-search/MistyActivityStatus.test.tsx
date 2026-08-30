import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMistyActivityPhrase } from "./MistyActivityStatus";

afterEach(() => vi.useRealTimers());

describe("Misty activity phrases", () => {
  it("rotates calm status outside the transcript and honors tool-specific phases", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ activity }) => useMistyActivityPhrase(activity), {
      initialProps: { activity: undefined as string | undefined },
    });
    expect(result.current).toBe("Thinking it through…");
    act(() => vi.advanceTimersByTime(4_000));
    expect(result.current).toBe("Checking the details…");
    rerender({ activity: "using_weather.current" });
    expect(result.current).toBe("Checking the weather…");
  });
});
