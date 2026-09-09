import { browserBlockingOverlayOpen } from "@/features/browser/BrowserRuntimeBridge";
import { act, useEffect } from "react";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  MistyAppSDK,
  MistyComponentContext,
  MistyComponentMount,
  MistyBrowserEvent,
} from "@misty/sdk";
import { createWebsiteApp } from "./createWebsiteApp";
import { integrationIds, type WebsiteAppId } from "./websiteIntegrations";
vi.mock("@misty/browser-view", () => ({
  SDKBrowserView: ({
    provider,
    onView,
    context,
  }: {
    provider: { id: string; accountId: string };
    context: MistyComponentContext;
    onView: (view: unknown) => void;
  }) => {
    useEffect(() => {
      onView({
        handle: provider.accountId,
        contextId: "context",
        url: "https://docs.google.com/document/",
      });
      return () => onView(null);
    }, [provider, onView]);
    return (
      <div data-testid="website-canvas" data-active={context.active}>
        Website {provider.id} account {provider.accountId}
      </div>
    );
  },
}));
const mounts: MistyComponentMount[] = [];
afterEach(async () => {
  await act(async () => {
    for (const mount of mounts.splice(0)) await mount.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
async function fixture(
  appId: WebsiteAppId,
  route = `/apps/${appId}?view=integrations`,
  modern = true,
  space = false,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const root = document.createElement("div");
  document.body.append(root);
  const rows = new Map<string, unknown>(),
    listeners = new Set<(event: MistyBrowserEvent) => void>();
  let context: MistyComponentContext = {
    instanceId: crypto.randomUUID(),
    route,
    active: true,
    appearance: { mode: "dark" },
  };
  let mount: MistyComponentMount;
  const misty = {
    context: {
      get: async () => ({
        platform: "desktop",
        ...(space ? { space: { id: "space-a" } } : {}),
      }),
    },
    storage: {
      local: {
        get: async (key: string) => rows.get(key) ?? null,
        set: async (key: string, value: unknown) => {
          rows.set(key, value);
        },
        delete: async (key: string) => {
          rows.delete(key);
        },
        keys: async () => [...rows.keys()],
      },
    },
    navigation: {
      setItems: vi.fn(async () => {}),
      open: vi.fn(async (route: string) => {
        context = { ...context, route };
        mount?.update(context);
      }),
    },
    workspace: { setTitle: vi.fn(async () => {}) },
    activity: { report: vi.fn(async () => {}) },
    links: { openExternal: vi.fn(async () => {}) },
    browser: {
      availability: vi.fn(async () => ({
        available: true,
        persistent: true,
        ...(modern
          ? { supportedProviders: integrationIds(appId), profileCleanup: true }
          : {}),
      })),
      removeAccount: vi.fn(async () => {}),
      subscribe: vi.fn(
        async (
          _handle: string,
          listener: (event: MistyBrowserEvent) => void,
        ) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      ),
      overlay: vi.fn(async () => {}),
      back: vi.fn(async () => {}),
      forward: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
    },
  } as unknown as MistyAppSDK;
  const native = {
    appId,
    protocol: 2 as const,
    mount: vi.fn(
      async (input: { context: MistyComponentContext; root: HTMLElement }) => {
        const root = input.root;
        root.textContent = `Native ${input.context.route}`;
        return {
          update: (next: MistyComponentContext) => {
            root.textContent = `Native ${next.route}`;
          },
          unmount: vi.fn(),
        };
      },
    ),
  };
  await act(async () => {
    mount = await createWebsiteApp(appId, native).mount({
      root,
      misty,
      context,
    });
  });
  mounts.push(mount!);
  return {
    root,
    misty,
    rows,
    native,
    emit: (event: MistyBrowserEvent) => {
      listeners.forEach((listener) => listener(event));
    },
  };
}
it("filters the curated gallery and adds a service without a Space", async () => {
  const f = await fixture("planner"),
    ui = within(document.body);
  await ui.findByRole("button", { name: "Jira Cloud" });
  fireEvent.change(ui.getByRole("textbox", { name: "Search Planner" }), {
    target: { value: "jira" },
  });
  expect(ui.queryByRole("button", { name: "Todoist" })).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Add Jira Cloud" }));
  await ui.findByRole("textbox", { name: "Jira Cloud workspace" });
  fireEvent.change(await ui.findByRole("textbox", { name: "Profile name" }), {
    target: { value: "Work" },
  });
  fireEvent.change(ui.getByRole("textbox", { name: "Jira Cloud workspace" }), {
    target: { value: "https://team.atlassian.net" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Continue to sign in" }));
  await ui.findByTestId("website-canvas");
  expect(f.native.mount).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(f.misty.navigation.setItems).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "jira" })]),
    ),
  );
});
it("pins a document directly, follows navigation, and unpins without interrupting the website", async () => {
  const f = await fixture("journal"),
    ui = within(document.body);
  fireEvent.click(await ui.findByRole("button", { name: "Add Google Docs" }));
  fireEvent.change(await ui.findByRole("textbox", { name: "Profile name" }), {
    target: { value: "Personal" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Continue to sign in" }));
  await ui.findByTestId("website-canvas");
  await waitFor(() => expect(f.misty.browser.subscribe).toHaveBeenCalled());
  await act(async () => {
    f.emit({
      type: "page",
      phase: "finished",
      url: "https://docs.google.com/document/d/plan/edit",
    });
    f.emit({ type: "title", title: "Project plan" });
  });
  await waitFor(() =>
    expect(f.misty.workspace.setTitle).toHaveBeenLastCalledWith(
      "Project plan · Google Docs",
    ),
  );
  await act(async () => {
    f.emit({
      type: "page",
      phase: "finished",
      url: "https://organization.example/sso?code=private",
    });
    f.emit({ type: "title", title: "Organization sign-in" });
  });
  await waitFor(() =>
    expect(f.misty.workspace.setTitle).toHaveBeenLastCalledWith("organization.example · Google Docs"),
  );
  expect(
    ui.queryByRole("button", { name: "Return to Google Docs" }),
  ).toBeNull();
  await act(async () => {
    f.emit({
      type: "page",
      phase: "finished",
      url: "https://docs.google.com/document/d/plan/edit",
    });
    f.emit({ type: "title", title: "Project plan" });
  });
  expect(
    ui.queryByRole("button", { name: "Return to Google Docs" }),
  ).toBeNull();
  const canvas = ui.getByTestId("website-canvas");
  fireEvent.click(ui.getByRole("button", { name: "Pin" }));
  await ui.findByRole("button", { name: "Unpin" });
  expect(ui.queryByRole("dialog")).toBeNull();
  expect(ui.getByTestId("website-canvas")).toBe(canvas);
  await waitFor(() =>
    expect(f.misty.navigation.setItems).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "google-docs",
          children: expect.arrayContaining([
            expect.objectContaining({ label: "Project plan" }),
          ]),
        }),
      ]),
    ),
  );
  await act(async () =>
    f.emit({
      type: "page",
      phase: "finished",
      url: "https://docs.google.com/document/d/other/edit",
    }),
  );
  expect(ui.getByRole("button", { name: "Pin" })).toBeTruthy();
  await act(async () =>
    f.emit({
      type: "page",
      phase: "finished",
      url: "https://docs.google.com/document/d/plan/edit",
    }),
  );
  fireEvent.click(ui.getByRole("button", { name: "Unpin" }));
  await ui.findByRole("button", { name: "Pin" });
  expect([...f.rows.keys()].filter((key) => key.includes(":pin:"))).toEqual([]);
  expect(ui.getByTestId("website-canvas")).toBe(canvas);
});

it("offers a host update instead of creating an unsupported provider", async () => {
  const f = await fixture("journal", undefined, false),
    ui = within(document.body);
  fireEvent.click(await ui.findByRole("button", { name: "Add Notion" }));
  await ui.findByText("Update Misty to open Notion here.");
  expect(ui.queryByTestId("website-canvas")).toBeNull();
});
it.each([
  ["journal", "drawings"],
  ["journal", "notes"],
  ["planner", "tasks"],
  ["planner", "agenda"],
  ["planner", "roadmaps"],
] as const)(
  "preserves %s %s routes and switches repeatedly between native and the gallery",
  async (app, section) => {
    const route = `/apps/${app}?space=space-a&view=${section}`;
    const f = await fixture(app, route, true, true);
    expect(f.root.textContent).toBe(`Native ${route}`);
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await f.misty.navigation.open(`/apps/${app}?view=integrations`);
      });
      await within(f.root).findByRole("heading", {
        name: app[0].toUpperCase() + app.slice(1),
      });
      await act(async () => {
        await f.misty.navigation.open(route);
      });
      await waitFor(() => expect(f.root.textContent).toBe(`Native ${route}`));
    }
  },
);

it.each(["journal", "planner", "library"] as const)(
  "keeps %s integrations available through the sidebar route while the website stays mounted",
  async (app) => {
    const f = await fixture(app),
      ui = within(document.body);
    const label =
      app === "journal" ? "Notion" : app === "planner" ? "Todoist" : "Dropbox";
    fireEvent.click(await ui.findByRole("button", { name: `Add ${label}` }));
    fireEvent.change(await ui.findByRole("textbox", { name: "Profile name" }), {
      target: { value: "Personal" },
    });
    fireEvent.click(ui.getByRole("button", { name: "Continue to sign in" }));
    const canvas = await ui.findByTestId("website-canvas");
    const button = ui.getByRole("button", { name: "More website actions" });
    expect(button.closest("header")).not.toBeNull();
    expect(f.root.querySelector("footer")).toBeNull();
    await act(async () =>
      f.misty.navigation.open(
        `/apps/${app}?provider=${app === "journal" ? "notion" : app === "planner" ? "todoist" : "dropbox"}&drawer=integrations`,
      ),
    );
    const drawer = await within(document.body).findByRole("dialog", {
      name: app[0].toUpperCase() + app.slice(1),
    });
    expect(ui.getByTestId("website-canvas")).toBe(canvas);
    expect(canvas.getAttribute("data-active")).toBe("true");
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(within(drawer).queryByRole("button", { name: /Sharing/ })).toBeNull();
    expect(browserBlockingOverlayOpen()).toBe(true);
    expect(within(drawer).queryByRole("button", { name: "Browse" })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: "Added" })).toBeNull();
    expect(
      await within(drawer).findByRole("textbox", {
        name: `Search ${app[0].toUpperCase() + app.slice(1)}`,
      }),
    ).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: label }));
    await waitFor(() =>
      expect(within(document.body).queryByRole("dialog")).toBeNull(),
    );
    expect(ui.getByTestId("website-canvas")).toBe(canvas);
    expect(canvas.getAttribute("data-active")).toBe("true");
    await act(async () =>
      f.misty.navigation.open(
        `/apps/${app}?provider=${app === "journal" ? "notion" : app === "planner" ? "todoist" : "dropbox"}&manage=accounts`,
      ),
    );
    expect(ui.queryByRole("dialog")).toBeNull();
  },
);

it.each(["journal", "planner", "library"] as const)(
  "does not append integration chrome below the native %s workspace",
  async (app) => {
    const f = await fixture(app, `/apps/${app}?provider=misty`, true, true);
    expect(f.root.textContent).toContain("Native");
    expect(f.root.querySelector(".website-bottom-bar")).toBeNull();
    expect(f.root.querySelector(".integration-app-chrome")?.textContent).toBe(
      "",
    );
  },
);
