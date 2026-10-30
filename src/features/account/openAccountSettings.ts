import type { AccountHandoffPath } from "@/api/account/types";
import { mistyPublicPage } from "@/shared/platform/mistyPublicUrl";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";

/**
 * Opens the account surface on the Misty server's website in the system browser.
 *
 * Account management deliberately lives on the website: a browser is the
 * better place to manage account data and settings.
 *
 * The website is named at build time (MISTY_PUBLIC_URL / VITE_MISTY_PUBLIC_URL;
 * http://localhost:5174 in development). A build that names none has no account website.
 */
export async function openAccountSettingsInBrowser(
  path: AccountHandoffPath = "/settings",
): Promise<void> {
  const page = mistyPublicPage(path);
  if (!page) throw new Error("This Misty server has no account website.");
  await openSystemExternalLink(page);
}
