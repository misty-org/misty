import { expect, it, vi } from "vitest";
import type { MistyAppSDK } from "@misty/sdk";
import { loadMailWebsiteAccounts } from "./mailWebsiteAccounts";

it("discovers website profiles without contacting mailbox APIs", async () => {
  const call = vi.fn().mockResolvedValue({ connections: [
    { id: "mail", provider: "google", account_display: "test@example.com", capabilities: ["mail"], status: "needs_attention" },
    { id: "drive", provider: "google", account_display: "Other", capabilities: ["drive"] },
  ] });
  expect(await loadMailWebsiteAccounts({ server: { call } } as unknown as MistyAppSDK)).toEqual([
    { connection_id: "mail", provider: "google", email: "test@example.com", display_name: "test@example.com" },
  ]);
  expect(call).toHaveBeenCalledExactlyOnceWith("connections.list", {});
});