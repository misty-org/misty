import { act } from "react";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MistyComponentContext } from "@misty/sdk";
import { createProviderApp } from "../../../../../misty-apps/apps/shared/createProviderApp";
import { mountAppComponent } from "../rpc/component";
import { createAppRpcScope } from "../rpc/session";
import { createBrowserRpc, type BrowserRpcBackend } from "../rpc/browser";
import { createAppUiRpc } from "../rpc/appUi";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await act(close);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
it.each([
  ["chat", "instagram", "https://www.instagram.com/direct/inbox/"],
  ["chat", "messenger", "https://www.messenger.com/"],
  ["chat", "x", "https://x.com/messages"],
  ["chat", "discord", "https://discord.com/channels/@me"],
  ["chat", "slack", "https://slack.com/signin#/signin"],
  ["chat", "microsoft-teams", "https://teams.microsoft.com/"],
  ["inbox", "icloud", "https://www.icloud.com/mail/"],
  ["inbox", "yahoo", "https://mail.yahoo.com/"],
  ["inbox", "google", "https://mail.google.com/mail/u/0/#inbox"],
  ["inbox", "microsoft", "https://outlook.live.com/mail/"],
] as const)(
  "preserves the %s/%s native view through tab switches using the real shared component and RPC",
  async (appId, provider, url) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 50, 600, 400),
    );
    const root = document.createElement("div");
    document.body.append(root);
    const errors: string[] = [],
      records = new Map<string, unknown>();
    const scope = createAppRpcScope({
      identity: { appId, accountId: "user", instanceId: crypto.randomUUID() },
      scopes: [
        "browser.navigate",
        "browser.inspect",
        "browser.interact",
        "ai.use",
        "navigation.write",
        "storage.read",
        "storage.write",
      ],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    const backend = {
      initialUrl: () => "about:blank",
      constrainBounds: (value) => value,
      availability: async () => ({ available: true, persistent: true }),
      create: vi.fn<BrowserRpcBackend["create"]>(async () => {}),
      layout: vi.fn(async () => {}),
      navigate: vi.fn(async () => {}),
      back: vi.fn(async () => {}),
      forward: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      hide: vi.fn(async () => {}),
      overlay: vi.fn(async () => {}),
      subscribe: vi.fn<BrowserRpcBackend["subscribe"]>(async (_id, listener) => {
        listener({ type: "page", phase: "finished", url });
        return () => {};
      }),
      click: vi.fn(async () => {}),
      inspect: async () => ({
        url: "https://www.instagram.com/direct/inbox/",
        title: "Instagram",
        text: "Example conversation",
        truncated: false,
        interactive: [],
        contentTrust: "untrusted-web-page" as const,
      }),
    } satisfies BrowserRpcBackend;
    const browser = createBrowserRpc(scope, backend);
    const shortcut = vi.fn((_command: string, _listener: () => void) => () => {});
    const ui = createAppUiRpc(scope, {
      settings: () => ({}),
      setTitle: () => {},
      subscribeSettings: () => () => {},
      registerShortcut: shortcut,
      openExternal: async () => {},
      reportError: (error) => errors.push(error),
    });
    const context: MistyComponentContext = {
      instanceId: scope.identity.instanceId,
      route: `/apps/${appId === "chat" ? "social" : "inbox"}?provider=${provider}`,
      active: true,
      focused: true,
      appearance: { mode: "dark" },
    };
    const legacyMount = vi.fn(async () => ({ update: () => {}, unmount: () => {} }));
    const mounted = mountAppComponent({
      root,
      scope,
      context,
      definition: createProviderApp(appId, { protocol: 2, appId, mount: legacyMount }),
      release: () => {
        ui.close();
        void browser.close();
      },
      transport: {
        registerSurface: async () => () => {},
        subscribe: (topic, listener) =>
          topic.startsWith("browser:")
            ? browser.subscribe(topic, listener)
            : ui.subscribe(topic, listener),
        async request(message) {
          const params = message.params as { key: string; value?: unknown };
          if (["lifecycle.ready", "navigation.setItems"].includes(message.method)) return;
          if (message.method === "mail.accounts.list") return { accounts: [] };
          if (message.method === "context.get") return { platform: "desktop" };
          if (message.method === "storage.local.keys") return [...records.keys()];
          if (message.method === "storage.local.get") return records.get(params.key) ?? null;
          if (message.method === "storage.local.delete") {
            records.delete(params.key);
            return;
          }
          if (message.method === "storage.local.set") {
            records.set(params.key, params.value);
            return;
          }
          return message.method.startsWith("browser.")
            ? browser.request(message)
            : ui.request(message);
        },
      },
    });
    cleanups.push(async () => {
      await mounted.close();
      await browser.close();
    });
    await act(async () => mounted.ready);
    await waitFor(() => expect(backend.create).toHaveBeenCalledOnce());
    expect(backend.create.mock.calls[0][0]).toMatchObject({
      url,
      provider: { id: provider, accountId: `default-${provider}` },
    });
    expect(legacyMount).not.toHaveBeenCalled();
    expect(root.querySelector("[data-browser-page-host]")).not.toBeNull();
    expect(root.querySelector("[data-browser-toolbar]")).toBeNull();
    expect(shortcut.mock.calls.map((call) => call[0])).not.toContain("browser.annotation_undo");
    expect(errors).toEqual([]);
    const originalId = backend.create.mock.calls[0][0].id;
    for (let cycle = 0; cycle < 3; cycle++) {
      await act(async () => mounted.update({ ...context, active: false, focused: false }));
      await waitFor(() =>
        expect(backend.layout).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: originalId, visible: false }),
        ),
      );
      await act(async () => mounted.update(context));
      await waitFor(() =>
        expect(backend.layout).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: originalId, visible: true }),
        ),
      );
    }
    expect(backend.create).toHaveBeenCalledOnce();
    expect(backend.close).not.toHaveBeenCalled();
    expect(backend.navigate).not.toHaveBeenCalled();
    expect(backend.reload).not.toHaveBeenCalled();
    await act(async () =>
      mounted.update({ ...context, route: `${context.route}&drawer=integrations` }),
    );
    await waitFor(() =>
      expect(backend.layout).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: originalId, visible: true }),
      ),
    );
    expect(root.querySelector("[data-integration-trigger]")?.closest("header")).not.toBeNull();
    expect(root.querySelector("footer")).toBeNull();
    await act(async () => mounted.update(context));
    await waitFor(() =>
      expect(backend.layout).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: originalId, visible: true }),
      ),
    );
    expect(backend.create).toHaveBeenCalledOnce();
    const pin = await within(root).findByRole("button", { name: "Pin" });
    if (provider === "slack") {
      // The general sign-in page is deliberately not a pinnable workspace.
      expect((pin as HTMLButtonElement).disabled).toBe(true);
    } else {
      await waitFor(() => expect((pin as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(pin);
      fireEvent.click(await within(root).findByRole("button", { name: "Unpin" }));
      await within(root).findByRole("button", { name: "Pin" });
    }
    expect(backend.create).toHaveBeenCalledOnce();
    expect(backend.close).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  },
);
