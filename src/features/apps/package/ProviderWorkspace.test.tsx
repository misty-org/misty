import { act, useEffect, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import type {
  MistyBrowserEvent,
  MistyAppSDK,
  MistyComponentContext,
  MistyComponentDefinition,
  MistyComponentMount,
} from "@misty/sdk";
import { createProviderApp } from "../../../../../misty-apps/apps/shared/createProviderApp";
const opened = vi.hoisted(() => vi.fn());
vi.mock("@misty/browser-view", () => ({
  SDKBrowserView: (props: {
    provider: { id: string; accountId: string };
    initialUrl: string;
    context: MistyComponentContext;
    onView(view: unknown): void;
  }) => {
    const { provider, onView } = props;
    const latest = useRef(props);
    latest.current = props;
    useEffect(() => {
      opened({ id: provider.id, accountId: provider.accountId }, latest.current.initialUrl);
      let alive = true;
      void Promise.resolve().then(() => {
        if (alive)
          onView({
            handle: provider.accountId,
            contextId: `scope-${provider.accountId}`,
          });
      });
      return () => {
        alive = false;
        onView(null);
      };
    }, [provider.id, provider.accountId, onView]);
    return (
      <section
        data-website={props.provider.id}
        data-account={props.provider.accountId}
        data-initial-url={props.initialUrl}
        data-active={props.context.active}
      />
    );
  },
}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await act(cleanup);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  opened.mockReset();
});
async function fixture(
  route = "/apps/social?provider=misty",
  appId: "chat" | "inbox" = "chat",
  records = new Map<string, unknown>(),
  platform = "MacIntel",
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  const root = document.createElement("div");
  document.body.append(root);
  const legacyUpdate = vi.fn(),
    legacyClose = vi.fn();
  const legacy = {
    appId,
    protocol: 2,
    mount: vi.fn(async (input: { root: HTMLElement }) => {
      const root = input.root;
      root.innerHTML = '<div data-native="true">Existing messaging</div>';
      return {
        update: legacyUpdate,
        unmount: async () => {
          legacyClose();
          root.innerHTML = "";
        },
      };
    }),
  } as MistyComponentDefinition;
  const context: MistyComponentContext = {
    instanceId: "provider-tab",
    route,
    active: true,
    focused: true,
    appearance: { mode: "dark" },
  };
  const call = vi.fn(async (method: string) => {
    if (method === "mail.accounts.list") return { accounts: [] };
    throw new Error(`Unexpected server call ${method}`);
  });
  const listeners = new Map<string, (event: MistyBrowserEvent) => void>();
  const sdk = {
    context: { get: async () => ({ platform: "desktop" }) },
    navigation: { setItems: vi.fn(async () => {}), open: vi.fn(async () => {}) },
    workspace: { setTitle: vi.fn(async () => {}) },
    activity: { report: vi.fn(async () => {}) },
    shortcuts: { register: vi.fn(async () => () => {}) },
    storage: {
      local: {
        get: async (key: string) => records.get(key) ?? null,
        set: async (key: string, value: unknown) => {
          records.set(key, value);
        },
        delete: async (key: string) => {
          records.delete(key);
        },
        keys: async () => [...records.keys()],
      },
    },
    server: { call },
    links: { openExternal: vi.fn(async () => {}) },
    browser: {
      availability: async () => ({
        available: platform === "MacIntel",
        persistent: true,
        reason: "Embedded websites require Misty for Mac.",
      }),
      subscribe: async (handle: string, listener: (event: MistyBrowserEvent) => void) => {
        listeners.set(handle, listener);
        return () => {
          if (listeners.get(handle) === listener) listeners.delete(handle);
        };
      },
      inspect: async () => ({
        documentId: "page",
        title: "Instagram",
        text: "hello friend",
        interactive: [],
      }),
      overlay: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      navigate: vi.fn(async () => {}),
    },
    surfaces: { register: vi.fn(async () => () => {}) },
  } as unknown as MistyAppSDK;
  let mounted!: MistyComponentMount;
  await act(async () => {
    mounted = await createProviderApp(appId, legacy).mount({ root, misty: sdk, context });
  });
  const close = async () => {
    await mounted.unmount();
  };
  cleanups.push(close);
  return {
    root,
    ui: within(document.body),
    sdk,
    context,
    mounted,
    legacy,
    legacyClose,
    records,
    listeners,
    close,
  };
}
async function menu(f: Awaited<ReturnType<typeof fixture>>, label: string) {
  fireEvent.click(f.ui.getByRole("button", { name: "More website actions" }));
  const action = await within(document.body).findByRole("button", { name: label });
  await act(async () => fireEvent.click(action));
}
function selectedProfile(f: Awaited<ReturnType<typeof fixture>>) {
  return f.root.querySelector("[data-website]")?.getAttribute("data-account");
}
it("opens Instagram's DM view and preserves a saved native session without profile controls", async () => {
  const f = await fixture("/apps/social?provider=instagram");
  await waitFor(() =>
    expect(opened).toHaveBeenCalledWith(
      { id: "instagram", accountId: "default-instagram" },
      "https://www.instagram.com/direct/inbox/",
    ),
  );
  expect(f.ui.queryByRole("button", { name: /profiles/ })).toBeNull();
  await act(f.close);
  cleanups.pop();
  const reopened = await fixture("/apps/social?provider=instagram", "chat", f.records);
  await waitFor(() => expect(selectedProfile(reopened)).toBe("default-instagram"));
  const popup = await fixture(
    "/apps/social?provider=instagram&websiteAccount=default-instagram&providerPopup=auth",
    "chat",
    f.records,
  );
  await waitFor(() => expect(selectedProfile(popup)).toBe("default-instagram"));
});
it("keeps native Social available and redirects old Inbox API routes to websites", async () => {
  const social = await fixture("/apps/social?provider=messenger&experience=api");
  expect(social.root.querySelector("[data-native]")).not.toBeNull();
  const inbox = await fixture("/apps/inbox?provider=google&experience=api", "inbox");
  await waitFor(() => expect(selectedProfile(inbox)).toBe("default-google"));
  expect(inbox.root.querySelector("[data-native]")).toBeNull();
  expect(inbox.legacy.mount).not.toHaveBeenCalled();
  expect(inbox.ui.queryByText("Existing mailbox")).toBeNull();
});

it.each([
  ["chat", "/apps/social", ["Instagram", "Messenger", "X", "Discord"]],
  ["inbox", "/apps/inbox", ["Gmail", "Outlook"]],
] as const)(
  "opens %s at its integration directory without creating a website or listing unused providers in navigation",
  async (appId, route, labels) => {
    const f = await fixture(route, appId);
    await waitFor(() =>
      expect(
        f.ui.getByLabelText(appId === "chat" ? "Social platforms" : "Inbox platforms"),
      ).toBeTruthy(),
    );
    for (const label of labels)
      expect(f.ui.getByRole("button", { name: `Add ${label}` })).toBeTruthy();
    expect(opened).not.toHaveBeenCalled();
    expect(f.legacy.mount).not.toHaveBeenCalled();
    expect(f.sdk.navigation.setItems).toHaveBeenLastCalledWith(
      appId === "chat" ? [{ id: "misty", label: "Misty", route: `${route}?provider=misty` }] : [],
    );
    if (appId === "inbox")
      expect([...f.root.querySelectorAll("img[data-mail-provider-icon]")]).toHaveLength(2);
    fireEvent.click(f.ui.getByRole("button", { name: `Add ${labels[0]}` }));
    expect(f.sdk.navigation.open).toHaveBeenCalledWith(
      `${route}?provider=${appId === "chat" ? "instagram" : "google"}`,
    );
  },
);

it("saves website shortcuts without a sign-in confirmation and updates other tabs", async () => {
  const records = new Map<string, unknown>();
  const directory = await fixture("/apps/social", "chat", records);
  await directory.ui.findByRole("button", { name: "Add Instagram" });
  const website = await fixture("/apps/social?provider=instagram", "chat", records);
  await waitFor(() => expect(selectedProfile(website)).toBe("default-instagram"));
  expect(website.root.querySelectorAll("header")).toHaveLength(1);
  expect(website.root.querySelector(".provider-setup")).toBeNull();
  expect(website.ui.queryByText("I’ve signed in")).toBeNull();
  await directory.ui.findByRole("button", { name: "Open Instagram" });
  await waitFor(() =>
    expect(directory.sdk.navigation.setItems).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "instagram" })]),
    ),
  );
  const restored = await fixture("/apps/social", "chat", records);
  await within(restored.root).findByRole("button", { name: "Open Instagram" });
  expect(records.has("provider-website-confirmed:default-instagram")).toBe(false);
  expect(opened).toHaveBeenCalledOnce();
});
it.each(["/apps/inbox?provider=misty", "/apps/inbox?experience=api"])(
  "opens the provider directory for the retired Inbox route %s",
  async (route) => {
    const inbox = await fixture(route, "inbox");
    await inbox.ui.findByRole("button", { name: "Add Gmail" });
    expect(inbox.legacy.mount).not.toHaveBeenCalled();
    expect(inbox.sdk.navigation.setItems).toHaveBeenLastCalledWith([]);
    expect(inbox.root.querySelector("footer")).toBeNull();
  },
);

it("loads only API-connected mail providers into navigation and exposes partial failure in the directory", async () => {
  const f = await fixture("/apps/inbox", "inbox");
  vi.mocked(f.sdk.server.call).mockResolvedValue({
    accounts: [{ connection_id: "mail-1", provider: "microsoft", email: "test@example.com" }],
  } as never);
  const { notifyProviderAccounts } =
    await import("../../../../../misty-apps/apps/shared/accountStore");
  act(() => notifyProviderAccounts());
  await waitFor(() =>
    expect(f.sdk.navigation.setItems).toHaveBeenLastCalledWith([
      { id: "microsoft", label: "Outlook", route: "/apps/inbox?provider=microsoft", children: [] },
    ]),
  );
  vi.mocked(f.sdk.server.call).mockRejectedValue(new Error("offline"));
  act(() => notifyProviderAccounts());
  await waitFor(() => expect(f.ui.getByText(/Mail connections could not be checked/)).toBeTruthy());
  expect(f.ui.getByRole("button", { name: "Add Gmail" })).toBeTruthy();
});

it.each([
  ["chat", "slack", "Slack"],
  ["chat", "microsoft-teams", "Microsoft Teams"],
  ["inbox", "icloud", "iCloud Mail"],
  ["inbox", "yahoo", "Yahoo Mail"],
] as const)(
  "lists and opens %s/%s without advertising unavailable API actions",
  async (appId, provider, label) => {
    const route = `/apps/${appId === "chat" ? "social" : "inbox"}`;
    const f = await fixture(route, appId);
    await waitFor(() => expect(f.ui.getByRole("button", { name: `Add ${label}` })).toBeTruthy());
    expect(
      f.root.querySelector(`[data-integration="${provider}"] img[data-brand-icon]`),
    ).not.toBeNull();
    expect(f.sdk.navigation.setItems).not.toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: provider })]),
    );
    await act(async () =>
      f.mounted.update({ ...f.context, route: `${route}?provider=${provider}&experience=api` }),
    );
    await waitFor(() =>
      expect(f.root.querySelector(`[data-website="${provider}"]`)).not.toBeNull(),
    );
    expect(f.legacy.mount).not.toHaveBeenCalled();
    expect(f.ui.queryByRole("button", { name: "Connect mail search" })).toBeNull();
    expect(f.ui.queryByRole("button", { name: "Existing mailbox" })).toBeNull();
    expect(f.ui.queryByRole("button", { name: "Existing Social view" })).toBeNull();
    expect(f.ui.queryByText(/combined mail search currently covers/)).toBeNull();
    expect(f.sdk.links.openExternal).not.toHaveBeenCalled();
  },
);

it("keeps Inbox provider-only when embedded websites are unavailable", async () => {
  const f = await fixture("/apps/inbox?provider=google", "inbox", new Map(), "Linux");
  await f.ui.findByText("Embedded websites require Misty for Mac.");
  expect(f.legacy.mount).not.toHaveBeenCalled();
  expect(opened).not.toHaveBeenCalled();
  fireEvent.click(f.ui.getByRole("button", { name: "More website actions" }));
  fireEvent.click(await within(document.body).findByRole("button", { name: "Open link" }));
  expect(f.sdk.links.openExternal).toHaveBeenCalledWith("https://mail.google.com/mail/u/0/#inbox");
});

it("remembers Outlook's work mailbox across remount without changing profile or navigating the active message", async () => {
  const f = await fixture("/apps/inbox?provider=microsoft", "inbox");
  await waitFor(() => expect(f.listeners.has("default-microsoft")).toBe(true));
  const sendPage = async (url: string, phase: "started" | "finished" = "finished") => {
    await act(async () =>
      f.listeners.get("default-microsoft")!({ type: "page", url, phase } as MistyBrowserEvent),
    );
  };
  await sendPage("https://outlook.office.com/mail/inbox/id/message?code=temporary", "started");
  expect(JSON.stringify([...f.records.values()])).not.toContain("outlook.office.com");
  await sendPage("https://outlook.office.com/mail/inbox/id/message?code=temporary");
  await waitFor(() =>
    expect(JSON.stringify([...f.records.values()])).toContain("https://outlook.office.com/mail/"),
  );
  await sendPage("https://sso.gatech.edu/cas/login?ticket=private");
  expect(JSON.stringify([...f.records.values()])).not.toContain("private");
  expect(JSON.stringify([...f.records.values()])).not.toContain("temporary");
  expect(f.sdk.browser.navigate).not.toHaveBeenCalled();
  expect(f.root.querySelector("[data-website]")?.getAttribute("data-initial-url")).toBe(
    "https://outlook.live.com/mail/",
  );
  expect(opened).toHaveBeenCalledTimes(1);
  await act(f.close);
  cleanups.pop();
  const reopened = await fixture("/apps/inbox?provider=microsoft", "inbox", f.records);
  await waitFor(() =>
    expect(opened).toHaveBeenLastCalledWith(
      { id: "microsoft", accountId: "default-microsoft" },
      "https://outlook.office.com/mail/",
    ),
  );
  expect(selectedProfile(reopened)).toBe("default-microsoft");
});

it("toggles one pin without opening a form, tracks page navigation, and removes legacy duplicates", async () => {
  const f = await fixture("/apps/social?provider=instagram");
  await waitFor(() => expect(f.listeners.has("default-instagram")).toBe(true));
  const emit = async (event: MistyBrowserEvent) => {
    await act(async () => f.listeners.get("default-instagram")!(event));
  };
  const url = "https://www.instagram.com/direct/inbox/";
  await emit({ type: "title", title: "(1) Instagram · Messages" });
  await waitFor(() =>
    expect((f.ui.getByRole("button", { name: "Pin" }) as HTMLButtonElement).disabled).toBe(false),
  );
  await act(async () => fireEvent.click(f.ui.getByRole("button", { name: "Pin" })));
  await f.ui.findByRole("button", { name: "Unpin" });
  expect(f.ui.queryByRole("dialog")).toBeNull();
  const rows = () =>
    [...f.records.entries()].filter(([key]) => key.startsWith("provider-page-pin-v1:"));
  expect(rows()).toHaveLength(1);
  expect(rows()[0][1]).toMatchObject({ label: "Messages", url });
  await emit({ type: "page", phase: "finished", url: "https://www.instagram.com/direct/t/other/" });
  expect(f.ui.getByRole("button", { name: "Pin" }).getAttribute("aria-pressed")).toBe("false");
  await emit({ type: "page", phase: "finished", url });
  expect(f.ui.getByRole("button", { name: "Unpin" })).toBeTruthy();
  f.records.set("provider-page-pin-v1:legacy", { ...(rows()[0][1] as object), id: "legacy" });
  await act(async () => fireEvent.click(f.ui.getByRole("button", { name: "Unpin" })));
  await f.ui.findByRole("button", { name: "Pin" });
  expect(rows()).toHaveLength(0);
  await menu(f, "Open link");
  expect(f.sdk.links.openExternal).toHaveBeenCalledWith(url);
});
