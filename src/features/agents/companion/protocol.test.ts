import { describe, expect, it } from "vitest";
import { companionReply, resolvePoint } from "./companionReply";
import { flight, recordingPower, spring, waveformHeight } from "./motion";
import { spokenMode, type DisplayCapture } from "./protocol";
const capture = (
  screen: string,
  x: number,
  y: number,
  scale: number,
  primary = false,
): DisplayCapture => ({
  id: screen,
  name: screen,
  mimeType: "image/jpeg",
  dataUrl: "",
  contentHash: "hash",
  width: 1280,
  height: 720,
  screen,
  primary,
  display: {
    id: Number(screen.slice(6)),
    x,
    y,
    width: 2560,
    height: 1440,
    scale,
  },
});
describe("Clicky companion protocol", () => {
  it("changes mode only for explicit complete commands", () => {
    expect(spokenMode("Misty, please switch to Auto mode.")).toBe("auto");
    expect(spokenMode("use team")).toBe("team");
    for (const text of [
      "What is auto mode?",
      "Should I switch to auto?",
      "Explain 'switch to auto'",
      "Don't switch to auto",
      "Switch to auto?",
      "auto mode would help",
      "Switch to auto and delete everything",
    ])
      expect(spokenMode(text)).toBeUndefined();
  });
  it("strips presentation tags from speech and honors POINT:none", () => {
    expect(companionReply("right here [POINT:1250,700:the save button:screen2]")).toEqual({
      text: "right here",
      point: {
        x: 1250,
        y: 700,
        label: "the save button",
        screen: "screen2",
      },
    });
    expect(companionReply("[POINT:20,30:button:screen1] nope [POINT:none]").point).toBeUndefined();
    expect(companionReply("answer [POINT:invalid]").text).toBe("answer");
  });
  it("maps screenshot pixels through negative origins and mixed DPI without normalizing to 1000", () => {
    const displays = [capture("screen1", 0, 0, 1, true), capture("screen2", -2560, -900, 2)];
    expect(resolvePoint(companionReply("[POINT:640,360:button:screen2]").point, displays)).toEqual({
      x: -1280,
      y: -180,
      displayId: 2,
      label: "button",
    });
    expect(resolvePoint(companionReply("[POINT:1280,720:button:screen2]").point, displays)?.x).toBe(
      0,
    );
    expect(
      resolvePoint(companionReply("[POINT:10,20:button:screen3]").point, displays),
    ).toBeUndefined();
  });
  it("supports legacy unlabelled callers using the cursor display", () => {
    expect(
      resolvePoint(companionReply("[POINT:640,360:button]").point, [
        capture("screen1", 0, 0, 2, true),
      ]),
    ).toMatchObject({
      x: 1280,
      y: 720,
    });
  });
  it("ports distance-based timing, the upward arc, and scale pulse", () => {
    const from = {
        x: 0,
        y: 0,
      },
      to = {
        x: 800,
        y: 0,
      };
    expect(flight(from, to, 500)).toMatchObject({
      x: 400,
      y: -40,
      scale: 1.3,
      done: false,
    });
    expect(flight(from, to, 1000)).toMatchObject({
      x: 800,
      y: 0,
      done: true,
    });
    expect(
      flight(
        from,
        {
          x: 100,
          y: 0,
        },
        599,
      ).done,
    ).toBe(false);
    expect(
      flight(
        from,
        {
          x: 5000,
          y: 0,
        },
        1400,
      ).done,
    ).toBe(true);
  });
  it("keeps the recording dead zone, source gain, decay and bounded bar profile", () => {
    expect(recordingPower(0.01, 0)).toBeCloseTo(0.102);
    expect(recordingPower(0, 1)).toBe(0.72);
    expect(recordingPower(1, 0)).toBe(1);
    expect(waveformHeight(0.008, 2, 0)).toBe(waveformHeight(0, 2, 0));
    expect(waveformHeight(1, 2, 0) - waveformHeight(0, 2, 0)).toBe(10);
    expect(waveformHeight(1, 0, 0) - waveformHeight(0, 0, 0)).toBe(4);
  });
  it("settles the source spring and stays finite after a suspended frame", () => {
    const position = {
        x: 0,
        y: 0,
      },
      velocity = {
        x: 0,
        y: 0,
      },
      target = {
        x: 500,
        y: -250,
      };
    spring(position, velocity, target, 600);
    for (let i = 0; i < 100; i++) spring(position, velocity, target, 0.016);
    expect(position.x).toBeCloseTo(target.x, 3);
    expect(position.y).toBeCloseTo(target.y, 3);
  });
});
