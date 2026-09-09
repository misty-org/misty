import { beforeEach, expect, it, vi } from "vitest";
import type { BrowserAskSnapshot } from "./browserAskContext";

const f = vi.hoisted(() => ({ api: vi.fn(), native: vi.fn(), profile: {} as any, scope: "view", assertSession: vi.fn() }));
vi.mock("@/api/client", () => ({ apiRequest: f.api, readApiSessionGeneration: () => 1, assertStableApiSession: f.assertSession }));
vi.mock("@/features/apps/rpc/nativeBackend", () => ({ nativeRpcBackend: { invoke: f.native } }));
vi.mock("@/features/browser/browserProviders", () => ({ providerBrowserProfile: () => f.profile }));
vi.mock("@/features/browser/browserRuntime", () => ({ browserRuntimeIdForScope: () => f.scope }));
import { bindBrowserAskTarget } from "./browserAskTargets";

const profileID = "a".repeat(64);
const deviceID = "device_00000000-0000-4000-8000-000000000001";
const snapshot = (): BrowserAskSnapshot => ({ id: "view", scopeId: "browser-scope", profileId: profileID, providerId: "google", spaceId: "family", revision: "1", contentHash: "hash",
  page: { url: "https://mail.google.com/mail/u/0/#inbox/pilot", title: "Pilot", content: "Reply please", documentRevision: "1", selection: true, editable: false, link: "", image: "" } });
const page = () => ({ url: snapshot().page.url, target: { scopeId: "browser-scope", profileId: profileID, origin: "https://mail.google.com", authentication: "unknown", trust: "host-observation" },
  semantic: { adapter: "gmail", version: 1, account: "pilot@example.com", thread: snapshot().page.url } });
const current = () => ({ enabled: true, callerApps: [], capabilities: ["inbox.read", "inbox.draft", "inbox.send"], target: {
  id: "00000000-0000-4000-8000-000000000002", revision: 1, providerId: "inbox/gmail", appId: "inbox", providerVersion: 1, spaceId: "family", label: "Gmail · pilot@example.com",
  binding: { kind: "browser", deviceId: deviceID, profileId: profileID, scopeId: "browser-scope", accountBindingId: "00000000-0000-4000-8000-000000000003", accountIdentity: "pilot@example.com", origins: ["https://mail.google.com"] },
} });

beforeEach(() => {
  vi.resetAllMocks();
  f.profile = { ownerAccountId: "owner", profileId: profileID, provider: { id: "google" }, originSpaceId: "family", scopeId: "browser-scope" };
  f.scope = "view";
  f.native.mockImplementation(async (operation) => operation === "browser_agent_execute" ? page() : undefined);
  let target = current().target;
  f.api.mockImplementation(async (path, init) => {
    if (path.startsWith("/me/sdk-targets?")) return { targets: [], nextCursor: null };
    if (path === "/me/sdk-targets") {
      const input = JSON.parse(init.body);
      target = { id: input.targetId, revision: input.expectedRevision + 1, appId: "inbox", providerId: input.providerId, providerVersion: input.providerVersion, spaceId: input.spaceId, label: input.label, binding: input.browser };
      return { target };
    }
    return { targets: [target] };
  });
});

it("binds only an observed account to the trusted native profile and originating Space", async () => {
  const result = await bindBrowserAskTarget(snapshot(), "owner", deviceID, () => {});
  expect(result).toMatchObject({ account: "pilot@example.com", threadReference: snapshot().page.url, capabilities: ["inbox.read", "inbox.draft", "inbox.send"] });
  const configure = f.api.mock.calls.find(([path]) => path === "/me/sdk-targets")!;
  expect(JSON.parse(configure[1].body)).toMatchObject({ spaceId: "family", callerApps: [], browser: { scopeId: "browser-scope", profileId: profileID, deviceId: deviceID, accountIdentity: "pilot@example.com" } });
  expect(f.native.mock.calls.filter(([name]) => name === "browser_agent_execute")).toEqual([["browser_agent_execute", expect.objectContaining({ request: expect.objectContaining({ operation: "browser.inspect" }) })]]);
  expect(f.native).toHaveBeenCalledWith("browser_agent_grant_revoke", expect.anything());
  expect(f.native).toHaveBeenLastCalledWith("browser_context_menu_availability", { request: expect.objectContaining({ account: "pilot@example.com", capabilities: ["inbox.read", "inbox.draft", "inbox.send"] }) });
});

it.each(["unknown account", "wrong profile", "wrong origin", "changed URL", "different adapter"])("does not configure actions for %s", async (failure) => {
  const observed = page();
  if (failure === "unknown account") observed.semantic.account = "";
  if (failure === "wrong profile") observed.target.profileId = "b".repeat(64);
  if (failure === "wrong origin") observed.target.origin = "https://evil.example";
  if (failure === "changed URL") observed.url = "https://mail.google.com/mail/u/1/";
  if (failure === "different adapter") observed.semantic.adapter = "outlook";
  f.native.mockImplementation(async (op) => op === "browser_agent_execute" ? observed : undefined);
  await expect(bindBrowserAskTarget(snapshot(), "owner", deviceID, () => {})).rejects.toThrow();
  expect(f.api).not.toHaveBeenCalled();
  expect(f.native).toHaveBeenLastCalledWith("browser_agent_grant_revoke", expect.anything());
});

it("rejects a closed or replacement view before inspecting", async () => {
  f.scope = "replacement";
  await expect(bindBrowserAskTarget(snapshot(), "owner", deviceID, () => {})).rejects.toThrow("view changed");
  expect(f.native).not.toHaveBeenCalled();
});

it.each(["changed", "disabled"])("never silently restores an existing %s account", async (kind) => {
  const record = current();
  if (kind === "changed") record.target.binding.accountIdentity = "other@example.com";
  else record.enabled = false;
  f.api.mockResolvedValue({ targets: [record], nextCursor: null });
  await expect(bindBrowserAskTarget(snapshot(), "owner", deviceID, () => {})).rejects.toThrow("Confirm the intended account");
  expect(f.api.mock.calls.some(([path]) => path === "/me/sdk-targets")).toBe(false);
});

it("reuses the binding without changing its revision and honors reduced permissions", async () => {
  const record = current();
  record.capabilities = ["inbox.read"];
  f.api.mockImplementation(async (path) => path.startsWith("/me/sdk-targets?") ? { targets: [record], nextCursor: null } : { targets: [record.target] });
  const result = await bindBrowserAskTarget(snapshot(), "owner", deviceID, () => {});
  expect(result?.target.revision).toBe(1);
  expect(result?.capabilities).toEqual(["inbox.read"]);
  expect(f.api.mock.calls.some(([path]) => path === "/me/sdk-targets")).toBe(false);
});

it("only advertises actions that the server resolves for this installation", async () => {
  const record = current();
  f.api.mockImplementation(async (path, init) => path.startsWith("/me/sdk-targets?") ? { targets: [record], nextCursor: null } :
    { targets: JSON.parse(init.body).capability === "inbox.read" ? [record.target] : [] });
  expect((await bindBrowserAskTarget(snapshot(), "owner", deviceID, () => {}))?.capabilities).toEqual(["inbox.read"]);
});

it("offers task suggestions only for a resolved Planner in the originating Space", async () => {
  const record = current();
  const planner = { id: "00000000-0000-4000-8000-000000000004", revision: 1, appId: "planner", providerId: "planner/tasks", providerVersion: 1, spaceId: "family", label: "Family Planner", binding: { kind: "backend", connectionId: "00000000-0000-4000-8000-000000000005" } };
  f.api.mockImplementation(async (path, init) => path.startsWith("/me/sdk-targets?") ? { targets: [record], nextCursor: null } :
    { targets: JSON.parse(init.body).capability === "tasks.create" ? [planner] : [record.target] });
  await bindBrowserAskTarget(snapshot(), "owner", deviceID, () => {});
  expect(f.native).toHaveBeenLastCalledWith("browser_context_menu_availability", { request: expect.objectContaining({ spaceId: "family", capabilities: ["inbox.read", "inbox.draft", "inbox.send", "tasks.create"] }) });
  planner.spaceId = "work";
  await bindBrowserAskTarget(snapshot(), "owner", deviceID, () => {});
  expect(f.native).toHaveBeenLastCalledWith("browser_context_menu_availability", { request: expect.objectContaining({ capabilities: ["inbox.read", "inbox.draft", "inbox.send"] }) });
});

it("aborts an account switch after inspection and revokes its temporary native grant", async () => {
  let switched = false;
  f.native.mockImplementation(async (op) => { if (op === "browser_agent_execute") { switched = true; return page(); } });
  await expect(bindBrowserAskTarget(snapshot(), "owner", deviceID, () => { if (switched) throw new Error("Account changed"); })).rejects.toThrow("Account changed");
  expect(f.api).not.toHaveBeenCalled();
  expect(f.native).toHaveBeenLastCalledWith("browser_agent_grant_revoke", expect.anything());
});
