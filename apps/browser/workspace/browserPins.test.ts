import { expect, it } from "vitest";
import type { MistyAppSDK } from "@misty/sdk";
import {
  browserPinUrl,
  loadBrowserPins,
  toggleBrowserPin,
} from "./browserPins";
function storage() {
  const values = new Map<string, unknown>();
  return {
    keys: async () => [...values.keys()],
    get: async <T>(key: string) => (values.get(key) ?? null) as T | null,
    set: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  } as MistyAppSDK["storage"]["local"];
}
it("concurrent pins converge and preserve distinct query and fragment destinations", async () => {
  const store = storage();
  await Promise.all([
    toggleBrowserPin(store, "https://example.com", "One"),
    toggleBrowserPin(store, "https://example.com/", "One"),
  ]);
  expect(await loadBrowserPins(store)).toHaveLength(1);
  await toggleBrowserPin(store, "https://example.com/#two", "Two");
  await toggleBrowserPin(store, "https://example.com/?page=3", "Three");
  expect(await loadBrowserPins(store)).toHaveLength(3);
  await toggleBrowserPin(store, "https://example.com", "One");
  expect((await loadBrowserPins(store)).map((pin) => pin.label)).toEqual([
    "Two",
    "Three",
  ]);
});
it("rejects non-web and credential-bearing URLs and falls back to a readable hostname", async () => {
  const store = storage();
  for (const url of [
    "about:blank",
    "file:///secret",
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "invalid",
  ]) {
    expect(browserPinUrl(url)).toBeUndefined();
    await toggleBrowserPin(store, url, "Invalid");
  }
  expect(await loadBrowserPins(store)).toEqual([]);
  await toggleBrowserPin(store, "https://example.com", "");
  expect((await loadBrowserPins(store))[0].label).toBe("example.com");
});
