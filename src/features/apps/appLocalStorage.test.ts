import { beforeEach, expect, it } from "vitest";
import { appLocalStoragePrefix } from "./appLocalStorage";
beforeEach(() => localStorage.clear());
it("preserves conflicting old Space records and isolates other accounts", () => {
  const identity = `${encodeURIComponent("https://misty.test")}:one:example:`;
  const first = `misty:app:v3:${identity}family:settings`;
  const second = `misty:app:v3:${identity}work:settings`;
  localStorage.setItem(first, "family");
  localStorage.setItem(second, "work");
  const prefix = appLocalStoragePrefix("https://misty.test", "one", "example", "");
  expect(localStorage.getItem(prefix + "settings")).toBe("family");
  expect(localStorage.getItem(first)).toBe("family");
  expect(localStorage.getItem(second)).toBe("work");
  expect(
    localStorage.getItem(
      appLocalStoragePrefix("https://misty.test", "two", "example", "") + "settings",
    ),
  ).toBeNull();
  localStorage.removeItem(prefix + "settings");
  appLocalStoragePrefix("https://misty.test", "one", "example", "work");
  expect(localStorage.getItem(prefix + "settings")).toBeNull();
});
it("keeps existing personal data when importing old Space keys", () => {
  const own = `misty:app:v4:${encodeURIComponent("https://misty.test")}:one:example:settings`;
  localStorage.setItem(own, "personal");
  localStorage.setItem(
    own.replace(":v4:", ":v3:").replace(":settings", ":family:settings"),
    "legacy",
  );
  appLocalStoragePrefix("https://misty.test", "one", "example", "");
  expect(localStorage.getItem(own)).toBe("personal");
});
