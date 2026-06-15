import { act } from "react";
import { fireEvent, within, waitFor } from "@testing-library/react";
import {
  createMistyAppSDK,
  type MistyComponentMount,
  type MistySurfaceAdapter,
  type MistyComponentContext,
} from "@misty/sdk";
import { expect, it, vi } from "vitest";
import definition from "./SDKInboxApp";
it("mounts the real Inbox screen through SDK mail/cache, emits its tab route and releases AI context", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = document.createElement("div");
  document.body.append(root);
  const lifetime = new AbortController();
  const message = {
    provider: "google",
    provider_id: "message-a",
    account_id: "mailbox",
    thread_id: "thread-a",
    subject: "SDK mailbox fixture",
    from: { email: "sender@example.invalid" },
    to: [],
    cc: [],
    bcc: [],
    reply_to: [],
    sent_at: "2026-09-05T00:00:00Z",
    snippet: "SDK email body",
    body: { text: "SDK email body", had_html: false, truncated: false },
    labels: [],
    unread: false,
    starred: false,
    draft: false,
    attachments: [],
  };
  const thread = {
    provider: "google",
    provider_id: "thread-a",
    account_id: "mailbox",
    subject: "SDK mailbox fixture",
    snippet: "SDK email body",
    participants: [],
    labels: [],
    last_message_at: message.sent_at,
    unread: false,
    starred: false,
    messages: [message],
  };
  const request = vi.fn(async (input: { method: string; params?: unknown }): Promise<unknown> => {
    switch (input.method) {
      case "ai.action.run":
      case "lifecycle.ready":
      case "navigation.setItems":
      case "navigation.open":
      case "workspace.title.set":
      case "mail.cache.write":
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
        return { folders: [] };
      case "mail.threads.list":
        return { threads: [thread] };
      case "mail.drafts.create":
        return {
          draft: { provider: "google", provider_id: "draft-a", account_id: "mailbox", message },
        };
      case "mail.drafts.send":
        return { message };
      case "mail.threads.get":
        return { thread };
      default:
        throw new Error(`Unexpected SDK request: ${input.method}`);
    }
  });
  const remove = vi.fn(),
    registerSurface = vi.fn(async (_adapter: MistySurfaceAdapter) => remove);
  const misty = createMistyAppSDK({ request, registerSurface });
  const context: MistyComponentContext = {
    instanceId: "inbox-a",
    route: "/apps/inbox?provider=google",
    active: true,
    appearance: { mode: "dark" },
  };
  let mounted: MistyComponentMount | undefined;
  try {
    await act(async () => {
      mounted = await definition.mount({ root, misty, context, signal: lifetime.signal });
    });
    const row = await within(root).findByText("SDK mailbox fixture");
    fireEvent.click(row);
    await waitFor(() =>
      expect(root.querySelector("[data-inbox-message-view]")?.getAttribute("data-state")).toBe(
        "open",
      ),
    );
    await waitFor(() => expect(registerSurface).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([input]) =>
            input.method === "navigation.open" &&
            String((input.params as { route: string }).route).includes("view=message"),
        ),
      ).toBe(true),
    );
    expect(root.textContent).toContain("SDK email body");
    expect(root.querySelector("iframe")).toBeNull();
    fireEvent.click(within(root).getByRole("button", { name: "Summarize with AI" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        method: "ai.action.run",
        params: { actionId: "thread-summary", selectionHash: expect.any(String) },
      }),
    );
    expect(root.textContent).not.toContain("AI Thread Summary");
    expect(within(root).queryByRole("button", { name: "Turn into Task" })).toBeNull();
    expect(within(root).queryByRole("button", { name: "Clip to Journal" })).toBeNull();
    expect(request.mock.calls.some(([input]) => input.method === "activity.report")).toBe(false);
    await act(async () =>
      registerSurface.mock.calls[registerSurface.mock.calls.length - 1]![0].applyArtifact?.({
        id: "reply-artifact",
        schemaVersion: 1,
        kind: "mail_draft",
        title: "Draft reply",
        summary: "Reply for review",
        sources: [],
        operations: {
          to: ["recipient@example.invalid"],
          subject: "AI assisted reply",
          text: "A draft to review.",
        },
        risk: "draft",
        approvalPolicy: "confirm",
        idempotencyKey: "reply-fixture",
        expiresAt: "2099-01-01T00:00:00Z",
        state: "applying",
      }),
    );
    fireEvent.click(await within(document.body).findByRole("button", { name: "Review send" }));
    const confirm = await within(document.body).findByRole("button", {
      name: "Send email",
    });
    expect(request.mock.calls.some(([input]) => input.method === "mail.drafts.send")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        method: "mail.drafts.send",
        params: {
          path: { draftID: "draft-a" },
          body: { connection_id: "connection-a", authoring_source: "ai", confirmed: true },
        },
      }),
    );
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull());
    await act(async () => mounted!.update({ ...context, active: false, focused: false }));
    fireEvent.keyDown(document, { key: "c" });
    expect(within(document.body).queryByRole("dialog")).toBeNull();
  } finally {
    await act(async () => {
      await mounted?.unmount();
      lifetime.abort();
    });
    root.remove();
    vi.unstubAllGlobals();
  }
  expect(remove).toHaveBeenCalled();
});
