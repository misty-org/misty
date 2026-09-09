import type { MistyBrowserBounds } from "@misty/sdk";
import { AppRpcError } from "./session";

/** Derive a profile without disclosing server/account identifiers to package code. */
export async function browserProfileId(
  serverBase: string,
  accountId: string,
  appId = "browser",
  provider?: { id: string; accountId: string },
): Promise<string> {
  const base = new URL(serverBase);
  base.search = "";
  base.hash = "";
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "misty-sdk-browser-v1",
      base.href.replace(/\/+$/, ""),
      accountId,
      appId,
      ...(provider ? [provider.id, provider.accountId] : []),
    ]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function constrainBrowserBounds(
  bounds: MistyBrowserBounds,
  root: HTMLElement,
): MistyBrowserBounds {
  if (!root.isConnected || document.visibilityState === "hidden")
    throw new AppRpcError("view_hidden", "The App view is not visible.");
  const rect = root.getBoundingClientRect();
  const x = Math.max(0, bounds.x, rect.left),
    y = Math.max(0, bounds.y, rect.top);
  const right = Math.min(window.innerWidth, rect.right, bounds.x + bounds.width);
  const bottom = Math.min(window.innerHeight, rect.bottom, bounds.y + bounds.height);
  if (right - x < 1 || bottom - y < 1)
    throw new AppRpcError("view_hidden", "The browser viewport is outside this App view.");
  return { x, y, width: right - x, height: bottom - y };
}
/** Only the selected deployment's mail callback may leave the provider boundary. */
export function providerOAuthCallback(provider: string, value: string, serverBase: string) {
  if (provider !== "google" && provider !== "microsoft") return undefined;
  const auth = new URL(value);
  const redirect = auth.searchParams.get("redirect_uri");
  const state = auth.searchParams.get("state");
  if (!redirect || !state) return undefined;
  const callback = new URL(redirect);
  const server = new URL(serverBase);
  const suffix = `/oauth/connections/${provider}/callback`;
  const paths = [suffix, `${server.pathname.replace(/\/+$/, "")}${suffix}`];
  if (
    callback.protocol !== "https:" ||
    callback.origin !== server.origin ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash ||
    !paths.includes(callback.pathname)
  )
    throw new AppRpcError(
      "provider_callback",
      "This connection cannot return to the current Misty server.",
    );
  return { url: callback.href, state };
}
