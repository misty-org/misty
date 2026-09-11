import { expect, it } from "vitest";
import { mistyBrowserProviders } from "@misty/sdk";
import { providerLaunchUrl, providerLoginUrls } from "./providerLoginUrls";
import { providers } from "./providers";
import { providerUrlAllowed } from "../browser/workspace/browserProviders";
import { savedWebsiteUrl } from "./websiteIntegrations";

it("covers every integration with an allowed HTTPS sign-in entry point", () => {
  expect(Object.keys(providerLoginUrls).sort()).toEqual(
    Object.keys(mistyBrowserProviders).sort(),
  );
  for (const id of Object.keys(providerLoginUrls) as Array<
    keyof typeof providerLoginUrls
  >) {
    expect(providerUrlAllowed(id, providerLoginUrls[id]), id).toBe(true);
    expect(providers[id].url, id).toBe(providerLoginUrls[id]);
    expect(providerLaunchUrl(id), id).toBe(providerLoginUrls[id]);
    expect(providerLaunchUrl(id, mistyBrowserProviders[id].url), id).toBe(
      providerLoginUrls[id],
    );
    if (providerLoginUrls[id] !== mistyBrowserProviders[id].url)
      expect(
        savedWebsiteUrl(id, providerLoginUrls[id]),
        `${id}: sign-in is not a pin`,
      ).toBeUndefined();
    const url = new URL(providerLoginUrls[id]);
    for (const key of [
      "state",
      "nonce",
      "code",
      "code_challenge",
      "access_token",
    ])
      expect(url.searchParams.has(key), `${id}: ${key}`).toBe(false);
  }
});

it("Google sign-in returns to the selected product", () => {
  for (const id of [
    "google",
    "google-docs",
    "google-drive",
    "google-calendar",
  ] as const) {
    const url = new URL(providerLoginUrls[id]);
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/ServiceLogin",
    );
    expect(url.searchParams.get("continue")).toBe(
      mistyBrowserProviders[id].url,
    );
  }
});

it("retains saved documents, workspace URLs, and work mailboxes", () => {
  for (const [id, url] of [
    ["google-docs", "https://docs.google.com/document/d/saved/edit"],
    ["jira", "https://team.atlassian.net/jira/your-work"],
    ["microsoft", "https://outlook.office.com/mail/"],
    ["discord", "https://discord.com/channels/123/456"],
  ] as const)
    expect(providerLaunchUrl(id, url)).toBe(url);
});
