import type { AccountHandoffPath } from "@/api/account/types";
import { mistyPublicPage } from "@/shared/platform/mistyPublicUrl";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";

/**
 * Opens the account surface on the website in the system browser.
 *
 * Account management deliberately lives on the website: a browser is the
 * better place to manage account data, billing, and settings.
 *
 * Uses the configured public website URL (controlled by Vite environment variables
 * such as MISTY_PUBLIC_URL / VITE_MISTY_PUBLIC_URL, defaulting to
 * http://localhost:5174 in dev and https://mistysys.com in production).
 */
export async function openAccountSettingsInBrowser(
  path: AccountHandoffPath | string = "/settings",
): Promise<void> {
  await openSystemExternalLink(mistyPublicPage(path));
}
