import { abortAny } from "@/api/client/abort_any";
import { describe, expect, it } from "vitest";

describe("abortAny without AbortSignal.any", () => {
  it("aborts when any signal aborts, with its reason", () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = abortAny([first.signal, second.signal], null);
    expect(combined.signal.aborted).toBe(false);
    second.abort("gone");
    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBe("gone");
  });

  it("starts aborted when a signal already is", () => {
    const first = new AbortController();
    first.abort("early");
    const combined = abortAny([first.signal, new AbortController().signal], null);
    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBe("early");
  });

  it("stops listening once disposed", () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = abortAny([first.signal, second.signal], null);
    combined.dispose();
    first.abort();
    expect(combined.signal.aborted).toBe(false);
  });

  it("uses the native combinator when there is one", () => {
    const first = new AbortController();
    const second = new AbortController();
    let called = 0;
    const native = (signals: AbortSignal[]) => {
      called += 1;
      return signals[0];
    };
    const combined = abortAny([first.signal, second.signal], native);
    expect(called).toBe(1);
    expect(combined.signal).toBe(first.signal);
  });
});
