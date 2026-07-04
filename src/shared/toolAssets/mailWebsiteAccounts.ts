import type { MistyAppSDK } from "@misty/sdk";

/** Website profiles need saved connection metadata, never live mailbox probes. */
export async function loadMailWebsiteAccounts(misty: MistyAppSDK) {
  const { connections } = await misty.server.call("connections.list", {});
  return (connections ?? [])
    .filter((connection) =>
      ["google", "microsoft"].includes(connection.provider) &&
      connection.capabilities?.includes("mail"),
    )
    .map((connection) => ({
      connection_id: connection.id,
      provider: connection.provider,
      email: connection.account_display.includes("@") ? connection.account_display : "",
      display_name: connection.account_display,
    }));
}
