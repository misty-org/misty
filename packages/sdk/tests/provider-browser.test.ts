import { expect, it, vi } from "vitest";
import { mistyBrowserContracts } from "@misty/contracts";
import { createMistyAppSDK } from "@misty/sdk";
const handle = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
it("forwards provider account identity without accepting credentials or native profiles", async () => {
  const request = vi.fn(async (message: { method: string; params?: unknown }) => {
    if (message.method === "browser.create") return { handle, contextId: documentId, url: "https://www.instagram.com/direct/inbox/" };
    if (message.method === "browser.type") return { prepared: true };
    if (message.method === "browser.request") return { status: 401, body: "{}", truncated: false };
    if (message.method === "browser.availability") return { available: false, persistent: false, reason: "Browser is unavailable" };
  });
  const sdk = createMistyAppSDK({ request });
  const input = { provider: { id: "instagram" as const, accountId: "personal" }, url: "https://www.instagram.com/direct/inbox/", bounds: { x: 0, y: 0, width: 400, height: 300 } };
  await sdk.browser.create(input);
  expect(request).toHaveBeenCalledWith({ method: "browser.create", params: { ...input, nativeLiveResize: false } });
  for (const extra of [{ cookies: "secret" }, { profileId: "another-profile" }]) expect(mistyBrowserContracts["browser.create"].params.safeParse({ ...input, ...extra }).success).toBe(false);
  await expect(sdk.browser.type(handle, documentId, "reply", "Draft only")).resolves.toEqual({ prepared: true });
  expect(request).toHaveBeenLastCalledWith({ method: "browser.type", params: { handle, documentId, elementRef: "reply", text: "Draft only" } });
  await expect(sdk.browser.request(handle, "//external.example/path")).rejects.toThrow();
  await expect(sdk.browser.request(handle, "/api/fixture")).resolves.toMatchObject({ status: 401 });
  await expect(sdk.browser.availability()).resolves.toMatchObject({ available: false });
});
it("reports supported providers additively and accepts only an account identity for cleanup",async()=> {
  const request = vi.fn(async(message:{method:string}) => message.method === "browser.availability" ? {available:true,persistent:true,supportedProviders:["google-docs","notion"],profileCleanup:true} : undefined);
  const sdk = createMistyAppSDK({request});
  expect((await sdk.browser.availability()).supportedProviders).toEqual(["google-docs","notion"]);
  await sdk.browser.removeAccount({id:"google-docs",accountId:"work"});
  expect(request).toHaveBeenLastCalledWith({method:"browser.removeAccount",params:{provider:{id:"google-docs",accountId:"work"}}});
  expect(mistyBrowserContracts["browser.removeAccount"].params.safeParse({provider:{id:"google-docs",accountId:"work"},profileId:"another-app"}).success).toBe(false);
});

it.each(["slack", "microsoft-teams", "icloud", "yahoo"] as const)("accepts an isolated website identity for %s", provider => {
  const schema = mistyBrowserContracts["browser.create"].params;
  const input = { provider: { id: provider, accountId: "work" }, bounds: { x: 0, y: 0, width: 400, height: 300 } };
  expect(schema.safeParse(input).success).toBe(true);
  expect(schema.safeParse({ ...input, provider: { ...input.provider, cookies: "secret" } }).success).toBe(false);
});

it("preserves host profile observations without promoting them to account verification", async () => {
  const target = { scopeId: "original-scope", profileId: "a".repeat(64), providerId: "google", origin: "https://accounts.google.com", authentication: "required" as const, accountIdentity: "unverified" as const, trust: "host-observation" as const, observedAt: "2026-09-07T20:00:00Z" };
  const snapshot = { documentId, url: "https://accounts.google.com/ServiceLogin", title: "Sign-in required", text: "Complete sign-in in the original browser.", truncated: true, interactive: [], contentTrust: "untrusted-web-page" as const, target };
  const sdk = createMistyAppSDK({request:vi.fn(async()=>snapshot)});
  expect((await sdk.browser.inspect(handle)).target).toEqual(target);
  const schema = mistyBrowserContracts["browser.inspect"].result;
  for (const change of [{accountIdentity:"verified"},{authentication:"authenticated"},{cookies:"session-secret"},{profileId:"../../another-account"}]) {
    expect(schema.safeParse({...snapshot,target:{...target,...change}}).success).toBe(false);
  }
  const {target: _target,...legacy}=snapshot;
  expect(schema.safeParse(legacy).success).toBe(true);
});
