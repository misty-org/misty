import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
import {
  MailDraftInputSchema,
  MailProviderIdSchema,
  MISTY_MAIL_CONTENT_MAX_BYTES,
  mistyMailContracts,
  parseAppRpcRequest,
  parseMethodParams,
  parseMethodResult,
} from "@misty/contracts";

const draft = {
  connection_id: "connection-a",
  to: [{ email: "recipient@example.invalid" }],
  subject: "SDK fixture",
  text: "Only a transport double receives this.",
};
const message = {
  provider: "outlook",
  provider_id: "AA+/%2F==",
  account_id: "mailbox",
  thread_id: "thread",
  subject: "SDK fixture",
  from: { email: "sender@example.invalid" },
  to: [],
  cc: [],
  bcc: [],
  reply_to: [],
  sent_at: "2026-09-05T00:00:00Z",
  snippet: "",
  body: { text: "fixture", had_html: false, truncated: false },
  labels: [],
  unread: false,
  starred: false,
  draft: false,
  attachments: [],
};
it("retains opaque provider IDs without relaxing Misty Space/connection identity", () => {
  for (const id of [
    "AA+//==",
    "AA%2FBB=",
    "provider?key#id",
    "a".repeat(320),
  ]) {
    expect(MailProviderIdSchema.parse(id)).toBe(id);
    expect(
      parseAppRpcRequest(
        {
          protocol: 2,
          method: "mail.threads.get",
          params: {
            path: { threadID: id },
            query: { connection_id: "connection-a" },
          },
        },
        "space-a",
      ).params.path,
    ).toMatchObject({ threadID: id });
  }
  for (const id of ["", "..", ".", "line\nbreak", "space id", "a".repeat(321)])
    expect(MailProviderIdSchema.safeParse(id).success).toBe(false);
  expect(() =>
    parseMethodParams("mail.threads.get", {
      path: { threadID: "thread" },
      query: { connection_id: "../another" },
    }),
  ).toThrow();
  expect(() =>
    parseAppRpcRequest(
      {
        protocol: 2,
        method: "mail.accounts.list",
        params: { path: { spaceID: "other" } },
      },
      "space-a",
    ),
  ).toThrow();
});
it("rejects unsupported mailbox actions, injected headers and unconfirmed sending before transport", async () => {
  const request = vi.fn(async (_input: { method: string }) => undefined);
  const sdk = createMistyAppSDK({ request });
  await expect(
    sdk.server.call("mail.drafts.send", {
      path: { draftID: "draft" },
      body: {
        connection_id: "connection-a",
        authoring_source: "ai",
        confirmed: false,
      },
    } as never),
  ).rejects.toThrow();
  expect(
    request.mock.calls.filter(([input]) => input.method !== "lifecycle.ready"),
  ).toHaveLength(0);
  for (const body of [
    { connection_id: "connection-a" },
    { connection_id: "connection-a", deleted: true },
    { connection_id: "connection-a", snooze_until: "tomorrow" },
  ])
    expect(() =>
      parseMethodParams("mail.threads.action", {
        path: { threadID: "thread" },
        body,
      }),
    ).toThrow();
  expect(() =>
    MailDraftInputSchema.parse({
      ...draft,
      subject: "Hello\r\nBcc: other@example.invalid",
    }),
  ).toThrow();
});
it("bounds decoded attachment bytes and UTF-8 text while accepting a draft above the old 4 MiB RPC limit", () => {
  const file = {
    filename: "Fixture.bin",
    content_type: "application/octet-stream",
    inline: false,
    data: Buffer.alloc(4 * 1024 * 1024).toString("base64"),
  };
  expect(
    MailDraftInputSchema.parse({ ...draft, attachments: [file] })
      .attachments?.[0].data.length,
  ).toBeGreaterThan(4 * 1024 * 1024);
  expect(() =>
    MailDraftInputSchema.parse({
      ...draft,
      text: "é".repeat(MISTY_MAIL_CONTENT_MAX_BYTES / 2 + 1),
    }),
  ).toThrow();
  expect(() =>
    MailDraftInputSchema.parse({ ...draft, attachments: [file, file, file] }),
  ).toThrow();
  expect(() =>
    MailDraftInputSchema.parse({
      ...draft,
      attachments: [{ ...file, data: "a=aa" }],
    }),
  ).toThrow();
});
it("calls the named confirmed-draft method and removes unexpected credential fields from mail responses", async () => {
  const request = vi.fn(async (input: { method: string; params?: unknown }) => {
    if (input.method === "mail.drafts.send")
      return {
        message: { ...message, access_token: "must-not-escape" },
        refresh_token: "must-not-escape",
      };
    return undefined;
  });
  const sdk = createMistyAppSDK({ request });
  const params = {
    path: { draftID: "AA+/%2F==" },
    body: {
      connection_id: "connection-a",
      authoring_source: "user" as const,
      confirmed: true as const,
    },
  };
  expect(await sdk.server.call("mail.drafts.send", params)).toEqual({
    message,
  });
  expect(request).toHaveBeenCalledWith({ method: "mail.drafts.send", params });
  expect(Object.keys(mistyMailContracts)).toHaveLength(8);
  expect(() =>
    parseMethodResult("mail.threads.get", {
      thread: { provider_id: "incomplete" },
    }),
  ).toThrow();
});
