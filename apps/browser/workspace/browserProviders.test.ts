import { expect, it } from "vitest";
import { browserProfileId } from "@/features/apps/rpc/browserBackend";
import {
  providerUrlAllowed,
  providerBelongsToApp,
  registerProviderBrowser,
  inheritProviderBrowser,
  popupBrowserProfile,
  forgetPopupBrowser,
  consumePopupBrowserInstance,
} from "./browserProviders";
it("isolates persistent provider profiles by website account, Misty account, provider and server", async () => {
  const profile = (
    user: string,
    provider: string,
    accountId: string,
    base = "https://misty.example/api",
  ) => browserProfileId(base, user, "chat", { id: provider, accountId });
  const baseline = await profile("user-a", "instagram", "personal");
  expect(await profile("user-a", "instagram", "personal")).toBe(baseline);
  for (const next of [
    profile("user-b", "instagram", "personal"),
    profile("user-a", "instagram", "work"),
    profile("user-a", "discord", "personal"),
    profile("user-a", "instagram", "personal", "https://other.example/api"),
  ])
    expect(await next).not.toBe(baseline);
});
it("allows provider login and internal navigation but rejects external destinations and URL tricks", () => {
  expect(
    providerUrlAllowed("google", "https://accounts.google.com/ServiceLogin"),
  ).toBe(true);
  expect(
    providerUrlAllowed("instagram", "https://www.instagram.com/direct/inbox/"),
  ).toBe(true);
  for (const url of [
    "https://instagram.com.evil.test/",
    "https://evilinstagram.com/",
    "http://instagram.com/",
    "https://user:secret@instagram.com/",
    "https://example.com/",
  ])
    expect(providerUrlAllowed("instagram", url)).toBe(false);
  expect(
    providerUrlAllowed("microsoft", "https://outlook.cloud.microsoft/mail/"),
  ).toBe(true);
  expect(
    providerUrlAllowed(
      "microsoft",
      "https://outlook.cloud.microsoft.evil.test/",
    ),
  ).toBe(false);
  expect(providerBelongsToApp("inbox", "instagram")).toBe(false);
  expect(providerBelongsToApp("chat", "instagram")).toBe(true);
});
it("inherits the live source account for Browser destinations, including external identity providers", () => {
  const profile = {
    profileId: "private-profile",
    provider: { id: "google" as const, accountId: "work" },
    ownerAccountId: "user-a",
    serverBase: "https://example.com/api",
  };
  const close = registerProviderBrowser("live", profile);
  try {
    inheritProviderBrowser(
      "auth-popup",
      "live",
      "https://accounts.google.com/ServiceLogin",
    );
    inheritProviderBrowser("external-popup", "live", "https://example.org");
    expect(popupBrowserProfile("auth-popup")).toMatchObject(profile);
    expect(popupBrowserProfile("external-popup")).toMatchObject(profile);
    inheritProviderBrowser("invalid-popup", "live", "javascript:alert(1)");
    expect(popupBrowserProfile("invalid-popup")).toBeUndefined();
    close();
    inheritProviderBrowser(
      "closed-popup",
      "live",
      "https://accounts.google.com",
    );
    expect(popupBrowserProfile("closed-popup")).toBeUndefined();
  } finally {
    close();
    forgetPopupBrowser("auth-popup");
    forgetPopupBrowser("external-popup");
  }
});
it("does not reuse adopted native popup handles or persist authentication URLs", () => {
  const close = registerProviderBrowser("source", {
    profileId: "a".repeat(64),
    provider: { id: "instagram", accountId: "work" },
    ownerAccountId: "user-a",
    ownerAppId: "chat",
    serverBase: "https://example.com",
  });
  try {
    inheritProviderBrowser(
      "transient",
      "source",
      "about:blank",
      "popup-native",
    );
    consumePopupBrowserInstance("transient");
    expect(popupBrowserProfile("transient")?.popupInstanceKey).toBeUndefined();
    expect(popupBrowserProfile("transient")?.url).toBeUndefined();
    inheritProviderBrowser(
      "auth-url",
      "source",
      "https://www.facebook.com/login.php?state=transient-state",
      "popup-native-two",
    );
    expect(
      localStorage.getItem("misty:provider-browser-tab:auth-url"),
    ).not.toContain("transient-state");
  } finally {
    close();
    forgetPopupBrowser("transient");
    forgetPopupBrowser("auth-url");
  }
});

it("allows X identity providers without granting them authenticated message request access", () => {
  for (const url of ["https://accounts.google.com/o/oauth2/auth", "https://appleid.apple.com/auth/authorize", "https://idmsa.apple.com/appleauth/auth/authorize"])
    expect(providerUrlAllowed("x", url)).toBe(true);
  for (const url of ["https://accounts.google.com.evil.test/", "http://accounts.google.com/", "https://user@appleid.apple.com/"])
    expect(providerUrlAllowed("x", url)).toBe(false);
});

it.each([
  ["slack", "chat", "https://team.slack.com/client/", "https://accounts.google.com/o/oauth2/auth"],
  ["microsoft-teams", "chat", "https://teams.cloud.microsoft/", "https://login.microsoftonline.com/common/oauth2/authorize"],
  ["icloud", "inbox", "https://www.icloud.com/mail/", "https://idmsa.apple.com/appleauth/auth/authorize"],
  ["yahoo", "inbox", "https://mail.yahoo.com/", "https://login.yahoo.com/"],
] as const)("keeps %s navigation, authentication and profile identity scoped to its owner", async (provider, owner, page, login) => {
  expect(providerUrlAllowed(provider, page)).toBe(true);
  expect(providerUrlAllowed(provider, login)).toBe(true);
  expect(providerBelongsToApp(owner, provider)).toBe(true);
  expect(providerBelongsToApp(owner === "chat" ? "inbox" : "chat", provider)).toBe(false);
  const url = new URL(page);
  for (const invalid of [page.replace("https:", "http:"), `https://${url.hostname}.evil.test/`, `https://secret@${url.hostname}/`, "https://example.com/"])
    expect(providerUrlAllowed(provider, invalid)).toBe(false);
  const id = await browserProfileId("https://misty.example", "one-user", owner, { id: provider, accountId: "personal" });
  expect(await browserProfileId("https://misty.example", "one-user", owner, { id: provider, accountId: "work" })).not.toBe(id);
});
