import { describe, expect, it } from "vitest";
import { parseSubtitlePrefs, scalePcm } from "./subtitlePrefs";

describe("subtitle preferences", () => {
  it("falls back one control at a time", () => {
    const prefs = parseSubtitlePrefs(
      JSON.stringify({ target: "ja", gain: 9, silenceSeconds: "soon", source: "xx" }),
    );
    expect(prefs).toMatchObject({
      target: "ja",
      gain: 1,
      silenceSeconds: 30,
      source: "auto",
      mode: "translate",
      save: false,
    });
  });

  it("starts over from something unreadable", () => {
    expect(parseSubtitlePrefs("not json").mode).toBe("translate");
  });
});

describe("scalePcm", () => {
  const samples = Uint8Array.from([0x00, 0x10, 0x00, 0xf0]); // 4096, -4096

  it("leaves full volume alone", () => {
    expect(scalePcm(samples, 1)).toBe(samples);
  });

  it("scales both signs and silences at zero", () => {
    expect([...scalePcm(samples, 0.5)]).toEqual([0x00, 0x08, 0x00, 0xf8]);
    expect([...scalePcm(samples, 0)]).toEqual([0, 0, 0, 0]);
  });
});
