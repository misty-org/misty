/** Disposable mail HTTP replies; the host and downloaded app still use real scoped SDK RPC. */
export const mailCalls: { method: string; params: Record<string, unknown> }[] = [];
const message = {
  provider: "google",
  provider_id: "message-a",
  account_id: "mailbox",
  thread_id: "thread-a",
  subject: "Downloaded Inbox SDK",
  from: { email: "sender@example.invalid", name: "SDK Fixture" },
  to: [{ email: "fixture@example.invalid" }],
  cc: [],
  bcc: [],
  reply_to: [],
  sent_at: "2026-09-05T00:00:00Z",
  snippet: "This message came through the Misty SDK.",
  body: {
    text: "This message came through the Misty SDK.\n\nThe host owns server access, file permissions and encrypted cache storage.",
    had_html: false,
    truncated: false,
  },
  labels: ["INBOX"],
  unread: false,
  starred: false,
  draft: false,
  attachments: [],
};
const thread = {
  provider: "google",
  provider_id: "thread-a",
  account_id: "mailbox",
  subject: message.subject,
  snippet: message.snippet,
  participants: [message.from],
  labels: ["INBOX"],
  last_message_at: message.sent_at,
  unread: false,
  starred: false,
  messages: [message],
};

export function inboxFixture() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || url.pathname !== "/app-runtime/rpc")
      return original(input, init);
    if (new Headers(init?.headers).get("Authorization") !== "Bearer disposable-sdk-session")
      throw new Error("Missing host-owned App session");
    const call = JSON.parse(String(init?.body));
    mailCalls.push(call);
    let result;
    switch (call.method) {
      case "mail.accounts.list":
        result = {
          accounts: [
            {
              connection_id: "connection-a",
              provider: "google",
              account_id: "mailbox",
              email: "fixture@example.invalid",
              display_name: "Fixture",
              total: 1,
              unread: 0,
            },
          ],
        };
        break;
      case "mail.folders.list":
        result = {
          folders: [
            {
              provider: "google",
              provider_id: "INBOX",
              account_id: "mailbox",
              name: "Inbox",
              kind: "inbox",
              system: true,
              total: 1,
              unread: 0,
            },
          ],
        };
        break;
      case "mail.threads.list":
        result = { threads: [thread] };
        break;
      case "mail.threads.get":
        result = { thread };
        break;
      case "mail.threads.action":
        result = {};
        break;
      case "mail.drafts.update":
        if (call.params.path.draftID !== "draft+/%opaque")
          throw new Error("Draft ID changed in transit");
      // Fall through: return the saved provider draft for both operations.
      case "mail.drafts.create":
        result = {
          draft: {
            provider: "google",
            provider_id: "draft+/%opaque",
            account_id: "mailbox",
            thread_id: thread.provider_id,
            message: {
              ...message,
              draft: true,
              subject: call.params.body.subject,
              body: { text: call.params.body.text, had_html: false, truncated: false },
            },
          },
        };
        break;
      case "mail.drafts.send":
        throw new Error("This verification must never send email");
      default:
        throw new Error(`Unexpected server method: ${call.method}`);
    }
    return Response.json(result);
  };
}
