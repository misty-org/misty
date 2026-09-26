import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { speech } = vi.hoisted(() => ({ speech: vi.fn() }));
vi.mock("@/api/agents/api", () => ({ agentsApi: { speech } }));
import { useAgentSpeech } from "./useAgentSpeech";

describe("Agent speech lifecycle", () => {
  const play = vi.fn().mockResolvedValue(undefined),
    pause = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "Audio",
      class {
        play = play;
        pause = pause;
        removeAttribute = vi.fn();
        onended = null;
        onerror = null;
      },
    );
    URL.createObjectURL = vi.fn(() => "blob:reply");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());
  it("aborts synthesis and never plays a late reply after Stop", async () => {
    let finish!: (blob: Blob) => void;
    speech.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useAgentSpeech("account:conversation"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.speak("invocation");
    });
    const signal = speech.mock.calls[0][1] as AbortSignal;
    act(() => result.current.stop());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(new Blob(["audio"]));
      await pending;
    });
    expect(play).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });
  it("releases playback and object URLs when conversation ownership changes", async () => {
    speech.mockResolvedValue(new Blob(["audio"]));
    const { result, rerender } = renderHook(({ scope }) => useAgentSpeech(scope), {
      initialProps: { scope: "a:one" },
    });
    await act(async () => result.current.speak("invocation"));
    expect(result.current.phase).toBe("speaking");
    rerender({ scope: "b:two" });
    expect(pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reply");
    expect(result.current.phase).toBe("idle");
  });
});
