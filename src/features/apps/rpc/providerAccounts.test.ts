import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mistyBrowserProviders, type MistyBrowserProvider } from "@misty/sdk";
import { browserProfileId } from "./browserIdentity";
import {
  providerAccountProfile,
  rememberProviderAccount,
  unlinkProviderAccount,
} from "./providerAccounts";

type Id = MistyBrowserProvider["id"];
const server = "https://example.com/api";
const provider = (id: Id) => ({ id, accountId: `default-${id}` });
const profile = (id: Id, owner = "alice", base = server) =>
  providerAccountProfile(base, owner, mistyBrowserProviders[id].owner, provider(id));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

it.each<Id[]>([
  ["google", "google-drive", "google-docs", "google-calendar", "youtube", "youtube-music"],
  [
    "microsoft",
    "onedrive",
    "microsoft-word",
    "microsoft-onenote",
    "outlook-calendar",
    "microsoft-todo",
    "microsoft-teams",
  ],
  ["icloud", "apple-music"],
  ["jira", "trello"],
])(
  "shares %s sign-in across its services, retaining the original primary profile",
  async (...ids) => {
    const first = ids[0];
    const legacy = await browserProfileId(
      server,
      "alice",
      mistyBrowserProviders[first].owner,
      provider(first),
    );
    const profiles = await Promise.all(ids.map((id) => profile(id)));
    expect(new Set(profiles)).toEqual(new Set([legacy]));
  },
);

it("isolates Misty accounts, deployments, unrelated providers and ordinary browsing", async () => {
  const google = await profile("google");
  for (const other of [
    profile("google", "bob"),
    profile("google", "alice", "https://other.example/api"),
    profile("google", "alice", "https://example.com/other"),
    profile("microsoft"),
    profile("slack"),
    profile("notion"),
    browserProfileId(server, "alice"),
  ])
    expect(await other).not.toBe(google);
  expect(await profile("google-drive", "alice", "https://EXAMPLE.com:443/api/?x=1#fragment")).toBe(
    google,
  );
});

it("retains all explicitly separate and legacy account identities", async () => {
  const profiles: string[] = [];
  for (const id of ["google", "google-drive"] as const) {
    for (const accountId of ["personal", "work", "mail-existing", "legacy-uuid"]) {
      const p = { id, accountId };
      const actual = await providerAccountProfile(
        server,
        "alice",
        mistyBrowserProviders[id].owner,
        p,
      );
      expect(actual).toBe(
        await browserProfileId(server, "alice", mistyBrowserProviders[id].owner, p),
      );
      expect(actual).not.toBe(await profile("google"));
      profiles.push(actual);
    }
  }
  expect(new Set(profiles).size).toBe(profiles.length);
});

it("records provider accounts once and unlinks one integration without removing shared sign-in", async () => {
  const id = await profile("google");
  rememberProviderAccount(id, provider("google"));
  rememberProviderAccount(id, provider("google-drive"));
  rememberProviderAccount(id, provider("google-drive"));
  const key = `misty:provider-account-v1:${id}`;
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
    family: "google",
    shared: true,
    integrations: [provider("google"), provider("google-drive")],
  });
  unlinkProviderAccount(id, provider("google-drive"));
  expect(JSON.parse(localStorage.getItem(key)!).integrations).toEqual([provider("google")]);
  unlinkProviderAccount(id, provider("google"));
  expect(JSON.parse(localStorage.getItem(key)!).integrations).toEqual([]);
  expect(await profile("google-drive")).toBe(id);
});

it("removes isolated account metadata and recovers malformed directory metadata", async () => {
  const p = { id: "google" as const, accountId: "work" };
  const id = await providerAccountProfile(server, "alice", "inbox", p);
  const key = `misty:provider-account-v1:${id}`;
  localStorage.setItem(key, "null");
  rememberProviderAccount(id, p);
  expect(JSON.parse(localStorage.getItem(key)!).shared).toBe(false);
  unlinkProviderAccount(id, p);
  expect(localStorage.getItem(key)).toBeNull();
});
