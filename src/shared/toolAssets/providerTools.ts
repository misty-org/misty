import type { MistyAppSDK, MistyBrowserInspection } from "@misty/sdk";
import { providers, type ProviderId } from "./providers";

export function providerNeedsLogin(provider: ProviderId, value: string) {
  try {
    const url = new URL(value);
    if (["slack", "microsoft-teams", "icloud", "yahoo"].includes(provider) && ["accounts.google.com", "login.live.com", "login.microsoftonline.com", "account.live.com", "appleid.apple.com", "idmsa.apple.com", "account.apple.com", "login.yahoo.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return true;
    if (provider === "slack" && /\/(?:signin|sign_in_with_password|workspace-signin)(?:\/|$)/.test(url.pathname)) return true;
    if (provider === "google" && url.hostname === "accounts.google.com")
      return true;
    if (
      provider === "microsoft" &&
      ["login.live.com", "login.microsoftonline.com"].includes(url.hostname)
    )
      return true;
    if (provider === "x" && ["accounts.google.com", "appleid.apple.com", "idmsa.apple.com"].includes(url.hostname))
      return true;
    return /\/(?:accounts\/login|login(?:\.php)?|signin|challenge|checkpoint|account\/access|i\/flow\/login|i\/jf\/onboarding)(?:\/|$)/i.test(
      url.pathname,
    );
  } catch {
    return false;
  }
}
function assertSignedIn(provider: ProviderId, page: MistyBrowserInspection) {
  const messengerLogin = provider === "messenger" && page.interactive.some(
    (control) => control.tag === "button" && /^log in$/i.test(control.name),
  ) && page.interactive.some((control) => control.tag === "input" && /email|phone/i.test(control.name));
  const publicMailLogin = ["icloud", "yahoo"].includes(provider) && page.interactive.some(control => ["button", "a"].includes(control.tag) && /^sign in(?: button)?$/i.test(control.name));
  if (providerNeedsLogin(provider, page.url) || messengerLogin || publicMailLogin)
    throw Object.assign(
      new Error(
        `Sign in to ${providers[provider].label} in this website account, then retry.`,
      ),
      { code: "authentication_required", provider },
    );
}

/** Provider-neutral operations backed by the current device's authenticated view. */
export function createProviderTools(
  misty: MistyAppSDK,
  provider: ProviderId,
  handle: string,
) {
  return {
    async read(): Promise<{
      page: MistyBrowserInspection;
      coverage: "visible-page";
    }> {
      const page = await misty.browser.inspect(handle);
      assertSignedIn(provider, page);
      return { page, coverage: "visible-page" };
    },
    async draft(
      page: MistyBrowserInspection,
      elementRef: string,
      text: string,
    ) {
      assertSignedIn(provider, page);
      return misty.browser.type(handle, page.documentId, elementRef, text);
    },
    async inbox() {
      return {
        status: "unavailable" as const,
        provider,
        reason:
          "Full-history access through this website account has not been verified. Read the visible page or use an existing API connection.",
      };
    },
    async send() {
      // A click acknowledgement is not delivery evidence. Until an adapter can verify a
      // provider message ID, sending stays in the actual website instead of claiming success.
      return {
        status: "unavailable" as const,
        reason:
          "Send through the provider website. Automated delivery verification is not available for this account.",
      };
    },
  };
}
