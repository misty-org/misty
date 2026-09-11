import { providerLoginUrls } from "./providerLoginUrls";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { mistyBrowserProviders, type MistyAppSDK } from "@misty/sdk";
import {
  integrationIds,
  integrationFromRoute,
  jiraWorkspace,
  savedWebsiteUrl,
} from "./websiteIntegrations";
import {
  addWebsiteService,
  ensureWebsiteSession,
  createWebsiteAccount,
  loadWebsiteState,
  saveWebsitePin,
  moveWebsitePin,
  removeWebsiteAccount,
  removeWebsiteService,
  saveWebsitePage,
  restoredWebsitePage,
  websiteNavigation,
  saveWebsiteDestination,
  restoredWebsiteDestination,
} from "./websiteStore";
import {
  providerBelongsToApp,
  providerUrlAllowed,
} from "../browser/workspace/browserProviders";
import { browserProfileId } from "@/features/apps/rpc/browserBackend";
export function websiteFixture() {
  const rows = new Map<string, unknown>();
  const storage = {
    get: async <T>(key: string) => (rows.get(key) ?? null) as T | null,
    set: async <T>(key: string, value: T) => {
      rows.set(key, value);
    },
    delete: async (key: string) => {
      rows.delete(key);
    },
    keys: async () => [...rows.keys()],
  };
  return {
    rows,
    storage,
    misty: {
      storage: { local: storage },
      browser: { removeAccount: vi.fn(async () => {}) },
    } as unknown as MistyAppSDK,
  };
}
it("keeps native and cross-app routes separate and gives each new service its owner", () => {
  expect(integrationIds("journal")).toHaveLength(4);
  expect(integrationIds("planner")).toHaveLength(7);
  expect(
    integrationFromRoute("/apps/journal?provider=google-calendar", "journal"),
  ).toBeUndefined();
  expect(
    integrationFromRoute("/apps/planner?view=agenda", "planner"),
  ).toBeUndefined();
  for (const app of ["journal", "planner"] as const)
    for (const id of integrationIds(app)) {
      expect(providerBelongsToApp(app, id)).toBe(true);
      expect(providerBelongsToApp("inbox", id)).toBe(false);
      expect(providerBelongsToApp("chat", id)).toBe(false);
      expect(providerUrlAllowed(id, mistyBrowserProviders[id].url)).toBe(true);
      for (const domain of mistyBrowserProviders[id].auth)
        expect(providerUrlAllowed(id, `https://${domain}/login`)).toBe(true);
      for (const url of [
        "https://evil.example/",
        `${mistyBrowserProviders[id].url.split("/").slice(0, 3).join("/")}.evil.test/`,
        "http://docs.google.com/",
        "https://docs.google.com:444/",
        "https://user:password@docs.google.com/",
      ])
        expect(providerUrlAllowed(id, url)).toBe(false);
    }
});
it("allows Calendar's Google Workspace sign-in landing page without saving it", () => {
  const landing = "https://workspace.google.com/products/calendar/";
  expect(providerUrlAllowed("google-calendar", landing)).toBe(true);
  expect(savedWebsiteUrl("google-calendar", landing)).toBeUndefined();
});
it("uses identical registry data in native and SDK policy", () => {
  const native = JSON.parse(
    readFileSync("src-tauri/src/infra/browser-providers.json", "utf8"),
  );
  expect(native).toEqual(mistyBrowserProviders);
});
it("requires a Jira Cloud team workspace and keeps authentication out of saved pages", () => {
  expect(
    jiraWorkspace("https://team-name.atlassian.net/jira/projects/ABC?x=1"),
  ).toBe("https://team-name.atlassian.net/jira/your-work");
  for (const value of [
    "https://atlassian.net",
    "https://a.b.atlassian.net",
    "https://team.atlassian.net.evil.test",
    "http://team.atlassian.net",
    "https://team.atlassian.net:444",
    "https://user:secret@team.atlassian.net",
    "https://jira.my-company.example",
  ])
    expect(jiraWorkspace(value)).toBeUndefined();
  for (const value of [
    "https://accounts.google.com/ServiceLogin",
    "https://docs.google.com/oauth/callback",
    "https://docs.google.com/document/?code=secret",
    "https://docs.google.com/document/#access_token=secret",
    "https://docs.google.com/document/?state=temporary",
  ])
    expect(savedWebsiteUrl("google-docs", value)).toBeUndefined();
  expect(
    savedWebsiteUrl(
      "google-docs",
      "https://docs.google.com/document/d/document-id/edit",
    ),
  ).toContain("document-id");
  expect(
    savedWebsiteUrl(
      "jira",
      "https://team.atlassian.net/jira/software/projects/ABC/boards/1",
    ),
  ).toContain("boards/1");
});
it("isolates identical account labels across owning apps and services", async () => {
  const id = (app: string, provider: string) =>
    browserProfileId("https://misty.example/api", "user", app, {
      id: provider,
      accountId: "work",
    });
  const profiles = await Promise.all([
    id("inbox", "google"),
    id("journal", "google-docs"),
    id("planner", "google-calendar"),
    id("journal", "google-calendar"),
  ]);
  expect(new Set(profiles).size).toBe(4);
});
it("preserves concurrent account and pin records, ordering and native sidebar hierarchy", async () => {
  const { storage } = websiteFixture();
  await addWebsiteService(storage, "google-docs");
  const [a, b] = await Promise.all([
    createWebsiteAccount(
      storage,
      "google-docs",
      "Personal",
      mistyBrowserProviders["google-docs"].url,
    ),
    createWebsiteAccount(
      storage,
      "google-docs",
      "Work",
      mistyBrowserProviders["google-docs"].url,
    ),
  ]);
  const first = {
      id: "one",
      provider: "google-docs" as const,
      accountId: a.id,
      label: "Document one",
      url: "https://docs.google.com/document/d/one/edit",
      order: 1,
    },
    second = {
      ...first,
      id: "two",
      accountId: b.id,
      label: "Document two",
      order: 2,
    };
  await Promise.all([
    saveWebsitePin(storage, first),
    saveWebsitePin(storage, second),
  ]);
  await moveWebsitePin(storage, second, first);
  const state = await loadWebsiteState(storage, "journal");
  expect(state.accounts).toHaveLength(2);
  expect(state.pins.map((p) => p.id)).toEqual(["two", "one"]);
  const navigation = websiteNavigation("journal", state, "space-1");
  expect(navigation.map((n) => n.id)).toEqual(["misty", "google-docs"]);
  expect(
    navigation
      .filter((n) => integrationIds("journal").some((id) => id === n.id))
      .map((n) => n.id),
  ).toEqual(["google-docs"]);
  expect(navigation[0].children?.map((n) => n.label)).toEqual([
    "Notes",
    "Drawings",
  ]);
  expect(
    navigation.find((n) => n.id === "google-docs")?.children?.[0].route,
  ).toContain(`account=${b.id}&pin=two`);
  expect(
    websiteNavigation("planner", {
      services: [],
      accounts: [],
      pins: [],
    })[0].children?.map((n) => n.label),
  ).toEqual(["Tasks", "Agenda", "Roadmaps"]);
});
it("restores safe pages and selections without keeping popup handles or sign-in redirects", async () => {
  const { storage } = websiteFixture();
  await addWebsiteService(storage, "google-docs");
  const account = await createWebsiteAccount(
    storage,
    "google-docs",
    "Work",
    mistyBrowserProviders["google-docs"].url,
  );
  await saveWebsitePage(
    storage,
    account,
    "https://docs.google.com/document/d/one/edit",
  );
  await saveWebsitePage(
    storage,
    account,
    "https://accounts.google.com/ServiceLogin?code=secret",
  );
  expect(await restoredWebsitePage(storage, account)).toBe(
    "https://docs.google.com/document/d/one/edit",
  );
  await saveWebsiteDestination(
    storage,
    "pane-one",
    `/apps/journal?provider=google-docs&account=${account.id}&providerPopup=temporary&websiteAccount=${account.id}`,
  );
  await saveWebsiteDestination(
    storage,
    "pane-two",
    "/apps/journal?provider=misty&view=drawings",
  );
  expect(await restoredWebsiteDestination(storage, "pane-one")).not.toContain(
    "temporary",
  );
  expect(await restoredWebsiteDestination(storage, "pane-two")).toContain(
    "drawings",
  );
});
it("removes only the selected account and its pins, retaining retryable cleanup on failure", async () => {
  const { storage, misty } = websiteFixture();
  await addWebsiteService(storage, "google-docs");
  const a = await createWebsiteAccount(
      storage,
      "google-docs",
      "Personal",
      mistyBrowserProviders["google-docs"].url,
    ),
    b = await createWebsiteAccount(
      storage,
      "google-docs",
      "Work",
      mistyBrowserProviders["google-docs"].url,
    );
  await saveWebsitePin(storage, {
    id: "one",
    provider: "google-docs",
    accountId: a.id,
    label: "Document",
    url: mistyBrowserProviders["google-docs"].url,
    order: 1,
  });
  vi.mocked(misty.browser.removeAccount).mockRejectedValueOnce(
    new Error("still in use"),
  );
  await expect(removeWebsiteAccount(misty, a)).rejects.toThrow("still in use");
  expect(
    (await loadWebsiteState(storage, "journal")).accounts.find(
      (item) => item.id === a.id,
    )?.removing,
  ).toBe(true);
  await removeWebsiteAccount(misty, a);
  expect(misty.browser.removeAccount).toHaveBeenLastCalledWith({
    id: "google-docs",
    accountId: a.id,
  });
  let state = await loadWebsiteState(storage, "journal");
  expect(state.accounts.map((item) => item.id)).toEqual([b.id]);
  expect(state.pins).toHaveLength(0);
  await removeWebsiteService(misty, state.services[0], state.accounts);
  state = await loadWebsiteState(storage, "journal");
  expect(state).toEqual({ services: [], accounts: [], pins: [] });
});

it.each(["planner", "journal", "library"] as const)(
  "opens each %s integration without profile setup and reuses its session",
  async (app) => {
    const { storage } = websiteFixture();
    for (const provider of integrationIds(app)) {
      const [first, concurrent] = await Promise.all([
        ensureWebsiteSession(storage, provider),
        ensureWebsiteSession(storage, provider),
      ]);
      expect(concurrent.id).toBe(first.id);
      expect(first.websiteUrl).toBe(providerLoginUrls[provider]);
      expect(await restoredWebsitePage(storage, first)).toBe(providerLoginUrls[provider]);
      expect((await ensureWebsiteSession(storage, provider)).id).toBe(first.id);
      expect(
        (await loadWebsiteState(storage, app)).accounts.some(
          (account) => account.id === first.id,
        ),
      ).toBe(true);
    }
  },
);

it("upgrades stored default landing pages while preserving custom documents and profile identity", async () => {
  const { storage } = websiteFixture();
  await addWebsiteService(storage, "google-docs");
  const account = await createWebsiteAccount(storage, "google-docs", "Work", mistyBrowserProviders["google-docs"].url);
  expect((await ensureWebsiteSession(storage, "google-docs")).id).toBe(account.id);
  expect(await restoredWebsitePage(storage, account)).toBe(providerLoginUrls["google-docs"]);
  await saveWebsitePage(storage, account, mistyBrowserProviders["google-docs"].url);
  expect(await restoredWebsitePage(storage, account)).toBe(providerLoginUrls["google-docs"]);
  const document = "https://docs.google.com/document/d/existing/edit";
  await saveWebsitePage(storage, account, document);
  expect(await restoredWebsitePage(storage, account)).toBe(document);
});
