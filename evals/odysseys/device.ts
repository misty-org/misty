// The person's own computer as a run's device: runs carry the workspace context a chat sent
// from it carries, signed through the debug build's eval bridge, so device tools (the agent's
// own browser session, its programs and shell) run on it as they would for a real request.
import { bridgeCall, type Bridge } from "./bridge.ts";

// The same grant a desktop chat carries (src/features/agents/deviceGrants.ts).
export const workspaceCapabilities = ["browser.tab.list", "browser.tab.open", "bookmark.list", "bookmark.add", "browser.session", "browser.run", "shell.run"];

export interface AccountDevice {
  id: string;
  name?: string;
  revokedAt?: string | null;
}

/** The device a pass runs on: the one named, else the account's only one. */
export function chooseDevice(devices: AccountDevice[], named: string): string {
  const active = devices.filter((device) => !device.revokedAt);
  if (named) {
    if (!active.some((device) => device.id === named))
      throw new Error(`Device ${named} isn't on this account. Sign the dev app in to the test account first.`);
    return named;
  }
  if (active.length === 1) return active[0]!.id;
  if (!active.length) throw new Error("This account has no device. Sign the dev app in to the test account first.");
  throw new Error(`This account has ${active.length} devices. Set MISTY_ODYSSEYS_DEVICE to one of: ${active.map((device) => device.id).join(", ")}.`);
}

/** The workspace context for one run, with a fresh grant the desktop signs. */
export async function deviceContexts(bridge: Bridge, apiBase: string, deviceId: string, userId: string, agentId: string): Promise<unknown[]> {
  const scope = `workspace:${deviceId}`;
  const signed = await bridgeCall<unknown[]>(bridge, "/run-grants", {
    apiBase,
    accountId: userId,
    grants: [{ targetDeviceId: deviceId, agentId, capabilities: workspaceCapabilities, scopes: [scope] }],
  });
  if (!signed[0]) throw new Error("run grant: the desktop signed nothing");
  return [{ device_id: deviceId, kind: "workspace", opaque_ref: scope, display_name: "Misty browser",
    capabilities: workspaceCapabilities, metadata: { source: "desktop" }, run_grant: signed[0] }];
}
