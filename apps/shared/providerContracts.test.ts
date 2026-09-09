import { describe, expect, it, vi } from "vitest";
import type {
  MailAccount,
  MailThread,
  MistyAppSDK,
  MistyBrowserInspection,
  MistyAiArtifact,
} from "@misty/sdk";
import {
  loadWebsiteAccounts,
  saveWebsiteAccounts,
  mailProfileId,
} from "./accountStore";
import {
  outlookMailboxDestination,
  parseWebsiteAccounts,
  providerFromRoute,
  providers,
} from "./providers";
import { searchMail, mailWebsiteUrl } from "./mailSearch";
import { providerSurface } from "./providerSurface";
import { createProviderTools, providerNeedsLogin } from "./providerTools";
const account = (id: string, provider = "google") =>
  ({ connection_id: id, provider, email: `${id}@example.com` }) as MailAccount;
const thread = (id: string, date: string) =>
  ({
    provider_id: id,
    subject: "Example",
    last_message_at: date,
  }) as MailThread;
function storage() {
  const rows = new Map<string, unknown>();
  return {
    rows,
    get: async <T>(key: string) => (rows.get(key) ?? null) as T | null,
    set: async <T>(key: string, value: T) => {
      rows.set(key, value);
    },
    keys: async () => [...rows.keys()],
    delete: async (key: string) => {
      rows.delete(key);
    },
  };
}
it("Instagram selects its real DM website, while Misty stays native and providers cannot cross app families", () => {
  expect(providerFromRoute("/apps/social?provider=instagram", "chat")).toBe(
    "instagram",
  );
  expect(providers.instagram.url).toBe(
    "https://www.instagram.com/direct/inbox/",
  );
  expect(providerFromRoute("/apps/social?provider=misty", "chat")).toBeNull();
  expect(providerFromRoute("/apps/social?provider=google", "chat")).toBeNull();
  expect(
    providerFromRoute("/apps/inbox?provider=instagram", "inbox"),
  ).toBeNull();
});
it("updates the Outlook starting URL without changing the isolated website account", () => {
  const account = {
    id: "personal",
    provider: "microsoft",
    label: "Personal",
    websiteUrl: "https://outlook.live.com/mail/0/inbox",
  };
  expect(parseWebsiteAccounts(JSON.stringify([account]))).toEqual([
    { ...account, websiteUrl: providers.microsoft.url },
  ]);
});
it("independent tab saves persist both isolated accounts, including legacy records", async () => {
  const area = storage();
  const a = { id: "one", provider: "instagram" as const, label: "Personal" };
  const b = { id: "two", provider: "instagram" as const, label: "Work" };
  await Promise.all([
    saveWebsiteAccounts(area, [a]),
    saveWebsiteAccounts(area, [b]),
  ]);
  expect(await loadWebsiteAccounts(area)).toEqual([a, b]);
  await area.set(
    "provider-website-accounts-v1",
    JSON.stringify([a, { ...b, id: "three" }]),
  );
  expect((await loadWebsiteAccounts(area)).map((value) => value.id)).toEqual([
    "one",
    "two",
    "three",
  ]);
  expect(await mailProfileId("connection-one")).toBe(
    await mailProfileId("connection-one"),
  );
  expect(await mailProfileId("connection-two")).not.toBe(
    await mailProfileId("connection-one"),
  );
});
it("searches all API accounts and retains successful results with account-specific failures and pagination", async () => {
  const accounts = [
    account("personal"),
    account("work", "microsoft"),
    account("expired"),
  ];
  const call = vi.fn(async (_method, input) => {
    const id = input.query.connection_id;
    if (id === "expired") throw new Error("Authorization expired");
    return {
      threads: [
        thread(
          id === "personal" ? "aaa" : "bbb",
          id === "personal" ? "2026-01-01" : "2026-02-01",
        ),
      ],
      next_page_token: id === "personal" ? "next" : null,
    };
  });
  const sdk = { server: { call } } as unknown as MistyAppSDK;
  const result = await searchMail(sdk, accounts, "meeting");
  expect(call).toHaveBeenCalledTimes(3);
  expect(result.results.map((value) => value.account.connection_id)).toEqual([
    "work",
    "personal",
  ]);
  expect(result.errors).toEqual([
    { account: accounts[2], message: "Authorization expired" },
  ]);
  expect(result.more).toEqual([{ account: accounts[0], token: "next" }]);
  call.mockClear();
  await searchMail(sdk, accounts, "meeting", result.more);
  expect(call).toHaveBeenCalledOnce();
  expect(call.mock.calls[0][1].query).toMatchObject({
    connection_id: "personal",
    page_token: "next",
    query: "meeting",
  });
  expect(mailWebsiteUrl(accounts[0], thread("abc123", ""))).toContain(
    "authuser=personal%40example.com#all/abc123",
  );
  expect(mailWebsiteUrl(accounts[1], thread("outlook-id", ""))).toBeNull();
  expect(mailWebsiteUrl(accounts[0], thread("../other", ""))).toBeNull();
});
describe("provider-neutral tools", () => {
  const page = {
    documentId: "page-current",
    text: "Conversation",
    interactive: [{ ref: "reply" }],
    title: "Instagram",
  } as MistyBrowserInspection;
  it("keeps drafts on the selected handle and never reports an automated send", async () => {
    const type = vi.fn(async () => ({ prepared: true }));
    const sdk = {
      browser: { type, inspect: vi.fn(async () => page) },
    } as unknown as MistyAppSDK;
    const tools = createProviderTools(sdk, "instagram", "account-one-handle");
    expect(await tools.read()).toEqual({ page, coverage: "visible-page" });
    await tools.draft(page, "reply", "Hello");
    expect(type).toHaveBeenCalledWith(
      "account-one-handle",
      "page-current",
      "reply",
      "Hello",
    );
    expect(await tools.send()).toMatchObject({ status: "unavailable" });
    const applied = vi.fn();
    const surface = providerSurface({
      appId: "chat",
      label: "Instagram",
      instanceId: "social-tab",
      contextId: "account-one-scope",
      page,
      tools,
      applied,
    });
    const artifact = {
      kind: "browser_action",
      baseRevision: "page-current",
      operations: {
        tab_scope_id: "account-one-scope",
        steps: [{ action: "type", target: "reply", value: "Prepared reply" }],
      },
    } as MistyAiArtifact;
    expect(surface.canApply!(artifact)).toBe(true);
    expect(surface.canApply!({ ...artifact, baseRevision: "old-page" })).toBe(
      false,
    );
    for (const operations of [
      {
        tab_scope_id: "account-two-scope",
        steps: [{ action: "type", target: "reply", value: "Wrong account" }],
      },
      {
        tab_scope_id: "account-one-scope",
        steps: [{ action: "click", target: "send" }],
      },
    ])
      expect(surface.canApply!({ ...artifact, operations })).toBe(false);
    await surface.applyArtifact!(artifact);
    expect(type).toHaveBeenLastCalledWith(
      "account-one-handle",
      "page-current",
      "reply",
      "Prepared reply",
    );
    expect(applied).toHaveBeenCalledOnce();
  });
});

it("reports reauthentication explicitly and never prepares text in a sign-in page", async () => {
  const type = vi.fn();
  const page = {
    url: "https://www.instagram.com/accounts/login/",
    documentId: "login",
    text: "Sign in",
    interactive: [],
  } as unknown as MistyBrowserInspection;
  const sdk = {
    browser: { inspect: async () => page, type },
  } as unknown as MistyAppSDK;
  const tools = createProviderTools(sdk, "instagram", "personal");
  await expect(tools.read()).rejects.toMatchObject({
    code: "authentication_required",
    provider: "instagram",
  });
  await expect(tools.draft(page, "login-field", "Draft")).rejects.toMatchObject(
    { code: "authentication_required" },
  );
  expect(type).not.toHaveBeenCalled();
  await expect(tools.inbox()).resolves.toMatchObject({ status: "unavailable" });
});

it.each([
  ["x", "https://x.com/i/jf/onboarding/web?mode=login"],
  ["x", "https://accounts.google.com/v3/signin/identifier"],
  ["x", "https://appleid.apple.com/auth/authorize"],
  ["messenger", "https://www.facebook.com/login.php"],
  ["discord", "https://discord.com/login?redirect_to=%2Fchannels%2F%40me"],
  ["microsoft", "https://login.live.com/oauth20_authorize.srf"],
] as const)("reports %s sign-in pages as requiring authentication: %s", async (provider, url) => {
  const page = { url, documentId: "login", text: "Sign in", interactive: [] } as unknown as MistyBrowserInspection;
  const sdk = { browser: { inspect: async () => page, type: vi.fn() } } as unknown as MistyAppSDK;
  await expect(createProviderTools(sdk, provider, "account").read()).rejects.toMatchObject({ code: "authentication_required" });
});
it("recognizes Messenger's root-page login form without confusing it with a conversation", async () => {
  const page = { url: "https://www.messenger.com/", documentId: "login", text: "Welcome", interactive: [
    { tag: "input", name: "Email or phone number" }, { tag: "button", name: "Log in" },
  ] } as unknown as MistyBrowserInspection;
  const sdk = { browser: { inspect: async () => page, type: vi.fn() } } as unknown as MistyAppSDK;
  await expect(createProviderTools(sdk, "messenger", "account").read()).rejects.toMatchObject({ code: "authentication_required" });
});

it.each([
  ["slack", "https://example.slack.com/signin"],
  ["slack", "https://accounts.google.com/ServiceLogin"],
  ["microsoft-teams", "https://login.microsoftonline.com/common/oauth2/authorize"],
  ["icloud", "https://idmsa.apple.com/appleauth/auth/authorize"],
  ["yahoo", "https://login.yahoo.com/"],
] as const)("recognizes %s reauthentication instead of reporting authenticated content", (provider, url) => {
  expect(providerNeedsLogin(provider, url)).toBe(true);
});

it.each([["icloud", "Sign In"], ["yahoo", "Sign in button"]] as const)("does not treat the %s welcome page as authenticated mail", async (provider, label) => {
  const sdk = { browser: { inspect: async () => ({ url: provider === "icloud" ? "https://www.icloud.com/mail/" : "https://mail.yahoo.com/", interactive: [{ tag: "button", name: label }], text: "Welcome" }) } } as unknown as MistyAppSDK;
  await expect(createProviderTools(sdk, provider, "fixture").read()).rejects.toMatchObject({ code: "authentication_required" });
});

it.each(["https://outlook.live.com/mail/0/inbox", "https://outlook.live.com/mail/?prompt=select_account"])("migrates old Outlook start %s without changing profile identity", (websiteUrl) => {
  const profile = { id: "same-profile", provider: "microsoft", label: "School", websiteUrl };
  expect(parseWebsiteAccounts(JSON.stringify([profile]))).toEqual([{ ...profile, websiteUrl: "https://outlook.live.com/mail/" }]);
});
it.each(["outlook.live.com", "outlook.office.com", "outlook.office365.com", "outlook.cloud.microsoft"])("remembers only a clean mailbox destination for %s", (host) => {
  expect(outlookMailboxDestination(`https://${host}/mail/inbox/id/private?token=secret#message`)).toBe(`https://${host}/mail/`);
});
it.each([
  "https://login.microsoftonline.com/common/oauth2/authorize?code=secret",
  "https://sso.gatech.edu/cas/login", "https://www.microsoft.com/outlook",
  "https://outlook.office.com.evil.test/mail/", "https://outlook.office.com/owa/auth/logon.aspx",
  "https://outlook.office.com/calendar/", "https://user@outlook.office.com/mail/",
  "http://outlook.office.com/mail/", "https://outlook.office.com:8443/mail/", "invalid",
])("does not save a temporary or unrelated navigation: %s", (url) => {
  expect(outlookMailboxDestination(url)).toBeUndefined();
});
