import type { AccountHandoffPath } from "@/models/interfaces/stores/account/useAccountStore";
import { accountCreateHandoffUrl, resolveAccountApiBase } from "@/stores/account/useAccountStore";
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
  await openSystemExternalLink(await handoffUrlOnConfiguredApi(url));
}

/**
 * Moves the minted hand-off onto the API origin this app actually talks to.
 *
 * The link is built server-side from AUTH_HANDOFF_START_URL, which is
 * deployment config the desktop app never sees. When a server has not set it,
 * the default is `http://localhost:8080` — an origin that answers nothing in
 * most setups, so the click opened a dead browser tab instead of the website.
 * Only the origin is deployment-specific; the token and path in the query are
 * what actually matter, so they are carried across unchanged.
 */
async function handoffUrlOnConfiguredApi(mintedUrl: string): Promise<string> {
  try {
    const apiBase = new URL(await resolveAccountApiBase());
    const minted = new URL(mintedUrl);
    minted.protocol = apiBase.protocol;
    minted.host = apiBase.host;
    // Assigning `host` leaves any existing port in place, so a minted
    // localhost:8080 would survive onto a host that serves port 443.
    minted.port = apiBase.port;
    // The base usually carries an "/api" prefix, and a proxy that only forwards
    // that prefix would never see a root-mounted hand-off path.
    const prefix = apiBase.pathname.replace(/\/+$/, "");
    if (prefix && !minted.pathname.startsWith(`${prefix}/`)) {
      minted.pathname = `${prefix}${minted.pathname}`;
    }
    return minted.toString();
  } catch {
    // An unparseable base is not worth failing the hand-off over: the minted
    // URL is still the server's own answer.
    return mintedUrl;
  }
}
