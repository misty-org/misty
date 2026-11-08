import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  channel: null as { onmessage: (link: string | null) => void } | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class {
    onmessage: (link: string | null) => void = () => undefined;
    constructor() {
      native.channel = this;
    }
  },
}));

import {
  beginGoogleSignInCodeWait,
  deliveredGoogleSignInCode,
  endGoogleSignInCodeWait,
} from "./googleSignInCode";
import {
  closeGoogleSignInSheet,
  mistyIsDefaultBrowser,
  openGoogleSignInSheet,
} from "./googleSignInSheet";

const url = "https://api.example/v1/auth/google/start?state=state";

it("reads whether Misty is the default browser, and treats unknown as no", async () => {
  native.invoke.mockResolvedValueOnce({ supported: true, isDefault: true });
  expect(await mistyIsDefaultBrowser()).toBe(true);
  native.invoke.mockResolvedValueOnce({ supported: true, isDefault: false });
  expect(await mistyIsDefaultBrowser()).toBe(false);
  native.invoke.mockRejectedValueOnce(new Error("no host"));
  expect(await mistyIsDefaultBrowser()).toBe(false);
});

beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  beginGoogleSignInCodeWait();
});
afterEach(() => {
  closeGoogleSignInSheet();
  endGoogleSignInCodeWait();
  vi.unstubAllGlobals();
});

it("hands the code from the link it caught to the waiting sign-in", async () => {
  const cancel = vi.fn();
  expect(await openGoogleSignInSheet(url, cancel)).toBe(true);
  native.channel!.onmessage("misty://auth/google/complete?code=ABCDEFGHJK");
  expect(deliveredGoogleSignInCode()).toBe("ABCDEFGHJK");
  expect(cancel).not.toHaveBeenCalled();
});

it("cancels the sign-in when the sheet is closed or brings no usable code", async () => {
  const cancel = vi.fn();
  await openGoogleSignInSheet(url, cancel);
  native.channel!.onmessage(null);
  expect(cancel).toHaveBeenCalledTimes(1);
  await openGoogleSignInSheet(url, cancel);
  native.channel!.onmessage("misty://auth/google/complete?code=nope");
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(deliveredGoogleSignInCode()).toBe("");
});

it("leaves it to the system browser off macOS, or when the sheet can't open", async () => {
  native.invoke.mockRejectedValueOnce(new Error("no sheet"));
  expect(await openGoogleSignInSheet(url, vi.fn())).toBe(false);
  vi.stubGlobal("navigator", { platform: "Win32" });
  native.invoke.mockClear();
  expect(await openGoogleSignInSheet(url, vi.fn())).toBe(false);
  expect(native.invoke).not.toHaveBeenCalled();
});

it("closes an open sheet once, and leaves a finished one alone", async () => {
  await openGoogleSignInSheet(url, vi.fn());
  closeGoogleSignInSheet();
  closeGoogleSignInSheet();
  expect(native.invoke).toHaveBeenCalledWith("google_sign_in_sheet_close");
  expect(
    native.invoke.mock.calls.filter(([command]) => command === "google_sign_in_sheet_close"),
  ).toHaveLength(1);
});
