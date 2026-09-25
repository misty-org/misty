import { expect, it } from "vitest";
import {
  loadProviderPins,
  saveProviderPin,
  deleteProviderPin,
} from "./providerPins";
import { providerNavigationItems } from "./providerDirectoryStore";
function websiteFixture() {
  const rows = new Map<string, unknown>();
  return {
    storage: {
      get: async <T>(key: string) => (rows.get(key) ?? null) as T | null,
      set: async <T>(key: string, value: T) => {
        rows.set(key, value);
      },
      delete: async (key: string) => {
        rows.delete(key);
      },
      keys: async () => [...rows.keys()],
    },
  };
}

it("preserves pins from separate accounts and routes each link to its owning profile", async () => {
  const { storage } = websiteFixture();
  const first = {
    id: "personal-pin",
    accountId: "personal",
    provider: "discord" as const,
    label: "Friends",
    url: "https://discord.com/channels/@me",
    order: 1,
  };
  const second = {
    ...first,
    id: "work-pin",
    accountId: "work",
    label: "Team",
    url: "https://discord.com/channels/1/2",
    order: 2,
  };
  await Promise.all([
    saveProviderPin(storage, first),
    saveProviderPin(storage, second),
  ]);
  const pins = await loadProviderPins(storage);
  expect(pins).toEqual([first, second]);
  const navigation = providerNavigationItems("chat", {
    accounts: [first, second].map((p) => ({
      id: p.accountId,
      provider: p.provider,
      label: p.accountId,
    })),
    added: new Set(["discord"]),
    hidden: new Set(),
    pins,
  });
  expect(navigation.map((item) => item.id)).toEqual(["misty", "discord"]);
  expect(
    navigation[1].children?.map((pin) =>
      new URL(pin.route, "https://misty.local").searchParams.get(
        "websiteAccount",
      ),
    ),
  ).toEqual(["personal", "work"]);
  await deleteProviderPin(storage, first.id);
  expect(await loadProviderPins(storage)).toEqual([second]);
});

it("resolves generic default pin names like Inbox to the account profile in navigation", () => {
  const genericPin = {
    id: "gmail-pin-1",
    accountId: "acct-1",
    provider: "google" as const,
    label: "Inbox",
    url: "https://mail.google.com/mail/u/0/#inbox",
    order: 1,
  };
  const specificPin = {
    id: "gmail-pin-2",
    accountId: "acct-1",
    provider: "google" as const,
    label: "Tax Documents 2026",
    url: "https://mail.google.com/mail/u/0/#search/taxes",
    order: 2,
  };
  const navigation = providerNavigationItems("inbox", {
    accounts: [
      {
        id: "acct-1",
        provider: "google",
        label: "mattdev727@gmail.com",
        email: "mattdev727@gmail.com",
      },
    ],
    added: new Set(["google"]),
    hidden: new Set(),
    pins: [genericPin, specificPin],
  });
  const googleSection = navigation.find((item) => item.id === "google");
  expect(googleSection).toBeDefined();
  expect(googleSection?.children?.map((c) => c.label)).toEqual([
    "mattdev727@gmail.com",
    "Tax Documents 2026",
  ]);
});
it.each([
  ["google", "https://accounts.google.com/signin?code=secret"],
  ["discord", "https://discord.com/login"],
  ["x", "https://x.com/i/jf/onboarding/web?mode=login"],
  ["slack", "https://team.slack.com/sign_in_with_password"],
  ["google", "https://mail.google.com/mail/?access_token=secret"],
] as const)(
  "never saves a temporary %s sign-in page",
  async (provider, url) => {
    const { storage } = websiteFixture();
    await expect(
      saveProviderPin(storage, {
        id: "pin",
        accountId: "account",
        provider,
        label: "Sign in",
        url,
        order: 1,
      }),
    ).rejects.toThrow(/Sign-in pages/);
    expect(await loadProviderPins(storage)).toEqual([]);
  },
);
