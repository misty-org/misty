import { afterEach, describe, expect, it, vi } from "vitest";
import { secureId } from "./secureId";

afterEach(() => vi.unstubAllGlobals());

describe("secure identifiers", () => {
  it("uses all 128 random bits when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 248, 249, 250, 251, 252, 253, 254, 255]);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    expect(secureId()).toBe("0001020304050607f8f9fafbfcfdfeff");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("fails closed when secure randomness is unavailable", () => {
    vi.stubGlobal("crypto", {});
    expect(() => secureId()).toThrow();
  });
});
