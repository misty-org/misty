import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { browserProfileId, constrainBrowserBounds } from "./browserBackend";
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("uses different browser storage for each account, deployment and app without leaking their identifiers", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const profile = await browserProfileId("https://example.com/api", "account-a");
  expect(profile).toMatch(/^[a-f0-9]{64}$/);
  expect(
    await browserProfileId("https://EXAMPLE.com:443/api/?ignored=1#fragment", "account-a"),
  ).toBe(profile);
  for (const [base, account, app] of [
    ["https://example.com/api", "account-b", "browser"],
    ["https://other.example/api", "account-a", "browser"],
    ["https://example.com/other", "account-a", "browser"],
    ["https://example.com/api", "account-a", "another-app"],
  ])
    expect(await browserProfileId(base, account, app)).not.toBe(profile);
});
it("clips native browser requests to the mounted app and refuses detached or offscreen roots", () => {
  const root = document.createElement("div");
  document.body.append(root);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 80, 500, 400));
  expect(constrainBrowserBounds({ x: 0, y: 0, width: 1000, height: 700 }, root)).toEqual({
    x: 100,
    y: 80,
    width: 500,
    height: 400,
  });
  expect(() => constrainBrowserBounds({ x: 700, y: 80, width: 100, height: 100 }, root)).toThrow(
    "outside this App view",
  );
  root.remove();
  expect(() => constrainBrowserBounds({ x: 100, y: 80, width: 100, height: 100 }, root)).toThrow(
    "not visible",
  );
});
