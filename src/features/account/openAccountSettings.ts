import type { AccountHandoffPath } from "@/models/interfaces/stores/account/useAccountStore";
import { accountCreateHandoffUrl } from "@/stores/account/useAccountStore";
import { openSystemExternalLink } from "@/platform/openExternalLink";

/**
 * Opens the account surface on the website, already signed in.
 *
 * Account management deliberately does not live in the desktop app: a browser
 * is the better place to show someone what data is held about them and to run
 * irreversible actions. The desktop app only reads the account for licensing.
 *
 * The server mints a single-use token; the URL it returns exchanges that token
 * for a browser session and redirects into the site, so the visitor is not
 * dropped on a sign-in wall.
 */
export async function openAccountSettingsInBrowser(
  path: AccountHandoffPath = "/settings",
): Promise<void> {
  const { url } = await accountCreateHandoffUrl(path);
  await openSystemExternalLink(url);
}
