import { afterEach, beforeEach, expect, it } from "vitest";
import type { OfficialApp } from "@/api/apps";
import { executeAppCapability, type AppCapabilityContext } from "./appCapabilityGateway";
import { createAppRpcScope } from "./rpc/session";
import { migratePlannerPreferences } from "./plannerPreferenceMigration";

const context: AppCapabilityContext = {
  app: {
    id: "planner",
    app_id: "com.misty.planner",
    official: true,
    scopes: ["storage.read", "storage.write"],
  } as OfficialApp,
  session: {
    app_id: "planner",
    space_id: "space-a",
    token: "fixture",
    sdk_base_url: "/app-runtime",
    scopes: ["storage.read", "storage.write"],
    expires_at: "2099-01-01T00:00:00Z",
  },
  serverBase: "https://misty.example/v1",
  user: { id: "user-a", name: "Fixture", email: "fixture@example.com" },
  platform: "desktop",
};
let current = true;
const scopes: ReturnType<typeof createAppRpcScope>[] = [];
const scope = () => {
  const value = createAppRpcScope({
    identity: { appId: "planner", accountId: "user-a", spaceId: "space-a", instanceId: "fixture" },
    scopes: context.session.scopes,
    expiresAt: context.session.expires_at,
    isCurrentAccount: () => current,
  });
  scopes.push(value);
  return value;
};
const target = async () => ({
  mode: "hosted" as const,
  scope: "hosted",
  apiBase: context.serverBase,
  serverUrl: null,
});
const get = (key: string) => executeAppCapability(context, "storage.local.get", { key });
beforeEach(() => {
  localStorage.clear();
  current = true;
});
afterEach(() => {
  scopes.splice(0).forEach((item) => item.close());
});

it("preserves this Space's preferences, gives scoped values precedence and never resurrects deleted values", async () => {
  const pins = "misty:roadmap-pins:user-a:space-a";
  const viewport = "misty:roadmap-viewport:user-a:space-a:map-a";
  localStorage.setItem(`${pins}:hosted`, '["scoped"]');
  localStorage.setItem(pins, '["legacy"]');
  localStorage.setItem(viewport, '{"x":15}');
  localStorage.setItem("misty:agenda-visibility:user-a:space-a", '{"tasks":false}');
  localStorage.setItem("misty:roadmap-pins:user-b:space-a:hosted", '["other-account"]');
  localStorage.setItem("misty:roadmap-pins:user-a:space-b:hosted", '["other-space"]');
  localStorage.setItem(`${viewport}:self-hosted-other`, '{"x":999}');
  await migratePlannerPreferences(context, scope(), target);
  expect(await get(pins)).toBe('["scoped"]');
  expect(await get(viewport)).toBe('{"x":15}');
  expect(await get("agenda-visibility:space-a")).toBe('{"tasks":false}');
  expect(await get("misty:roadmap-pins:user-b:space-a")).toBeNull();
  expect(await get("misty:roadmap-pins:user-a:space-b")).toBeNull();
  await executeAppCapability(context, "storage.local.delete", { key: pins });
  await migratePlannerPreferences(context, scope(), target);
  expect(await get(pins)).toBeNull();
  expect(localStorage.getItem(`${pins}:hosted`)).toBe('["scoped"]');
});

it("preserves newer SDK values and never borrows hosted preferences for another deployment", async () => {
  const pins = "misty:roadmap-pins:user-a:space-a";
  localStorage.setItem(pins, '["hosted"]');
  await migratePlannerPreferences(context, scope(), async () => ({
    ...(await target()),
    apiBase: "https://other.example/v1",
  }));
  expect(await get(pins)).toBeNull();
  await migratePlannerPreferences(context, scope(), async () => ({
    ...(await target()),
    mode: "self_hosted",
    scope: "self-hosted-one",
  }));
  expect(await get(pins)).toBeNull();
  await executeAppCapability(context, "storage.local.set", { key: pins, value: '["new"]' });
  await migratePlannerPreferences(context, scope(), target);
  expect(await get(pins)).toBe('["new"]');
});

it("aborts when the active account changes while resolving the deployment", async () => {
  localStorage.setItem("misty:roadmap-pins:user-a:space-a", '["private"]');
  await expect(
    migratePlannerPreferences(context, scope(), async () => {
      current = false;
      return target();
    }),
  ).rejects.toMatchObject({ code: "account_changed" });
  expect(await get("misty:roadmap-pins:user-a:space-a")).toBeNull();
});

it("copies only Journal pins for its account and Space, preserving existing SDK values", async () => {
  const journal: AppCapabilityContext = {
    ...context,
    app: { ...context.app, id: "journal", app_id: "com.misty.journal" },
    session: { ...context.session, app_id: "journal" },
  };
  const journalScope = createAppRpcScope({
    identity: {
      appId: "journal",
      accountId: "user-a",
      spaceId: "space-a",
      instanceId: "journal-fixture",
    },
    scopes: context.session.scopes,
    expiresAt: context.session.expires_at,
    isCurrentAccount: () => current,
  });
  scopes.push(journalScope);
  const pins = "misty:note-pins:user-a:space-a";
  localStorage.setItem(pins, '["note-a"]');
  localStorage.setItem("misty:drawing-pins:user-a:space-a", '["drawing-a"]');
  localStorage.setItem("misty:note-pins:user-b:space-a", '["private"]');
  localStorage.setItem("misty:roadmap-pins:user-a:space-a", '["planner-private"]');
  await executeAppCapability(journal, "storage.local.set", { key: pins, value: '["newer-note"]' });
  await migratePlannerPreferences(journal, journalScope, target);
  const read = (key: string) => executeAppCapability(journal, "storage.local.get", { key });
  expect(await read(pins)).toBe('["newer-note"]');
  expect(await read("misty:drawing-pins:user-a:space-a")).toBe('["drawing-a"]');
  expect(await read("misty:note-pins:user-b:space-a")).toBeNull();
  expect(await read("misty:roadmap-pins:user-a:space-a")).toBeNull();
});
