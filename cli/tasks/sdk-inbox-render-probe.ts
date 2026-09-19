/** Rendering fixture for the compiled Inbox component. All server/device responses are test doubles. */
import * as react from "react";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import {
  createMistyAppSDK,
  type MistyComponentDefinition,
  type MistySurfaceAdapter,
} from "@misty/sdk";
const definition: MistyComponentDefinition = (
  await import(/* @vite-ignore */ new URL("./inbox.js", location.href).href)
).default;
const calls: Array<{ method: string; params?: unknown }> = [],
  errors: string[] = [];
let surface: MistySurfaceAdapter | null = null;
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
const sdk = createMistyAppSDK({
  async request(input) {
    calls.push(input);
    switch (input.method) {
      case "ai.action.run":
        if (!surface || input.params?.actionId !== "thread-summary")
          throw new Error("No registered Inbox summary action.");
        return;
      case "lifecycle.ready":
      case "navigation.setItems":
      case "navigation.open":
      case "workspace.title.set":
      case "mail.cache.write":
      case "files.release":
        return;
      case "context.get":
        return {
          appId: "inbox",
          user: { id: "account-a" },
          space: { id: "space-a", name: "Product" },
        };
      case "mail.cache.read":
        return null;
      case "mail.accounts.list":
        return {
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
      case "mail.folders.list":
        return {
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
      case "mail.threads.list":
        return { threads: [thread] };
      case "mail.threads.get":
        return { thread };
      case "files.pickMany":
        return [{ handle: "attachment", name: "SDK attachment.txt", bytes: 3 }];
      case "files.readBytes":
        return new Uint8Array([79, 75, 10]).buffer;
      case "activity.report":
        errors.push(String((input.params as { message: string }).message));
        return;
      default:
        throw Error(`Unexpected Inbox probe call: ${input.method}`);
    }
  },
  async registerSurface(adapter) {
    surface = adapter;
    return () => {
      if (surface === adapter) surface = null;
    };
  },
});
const lifetime = new AbortController();
const mounted = await definition.mount({
  root: document.getElementById("root")!,
  misty: sdk,
  signal: lifetime.signal,
  context: {
    instanceId: "inbox-render",
    route: "/apps/inbox?provider=google",
    active: true,
    focused: true,
    appearance: { mode: "dark" },
  },
  libraries: { react, reactDom, reactDomClient, jsxRuntime, jsxDevRuntime: jsxRuntime },
});
Object.assign(window, {
  inboxProbe: {
    calls,
    errors,
    snapshot: () => ({ surface: !!surface }),
    close: async () => {
      await mounted.unmount();
      lifetime.abort();
    },
  },
});
