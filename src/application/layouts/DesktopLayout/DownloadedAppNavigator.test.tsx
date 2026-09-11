import { addNavigatorIntegration } from "@/features/apps/addNavigatorIntegration";
import { removeNavigatorPin } from "@/features/apps/removeNavigatorPin";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace";
import { DownloadedAppNavigator } from "./DownloadedAppNavigator";

vi.mock("@/features/apps/addNavigatorIntegration", () => ({
  addNavigatorIntegration: vi.fn(async () => {}),
}));

vi.mock("@/features/apps/removeNavigatorPin", () => ({
  removeNavigatorPin: vi.fn(async () => {}),
}));

afterEach(() => {
  cleanup();
  vi.mocked(addNavigatorIntegration).mockReset().mockResolvedValue(undefined);
  useWorkspaceStore.getState().reset();
  vi.restoreAllMocks();
  vi.mocked(removeNavigatorPin).mockReset().mockResolvedValue(undefined);
});
it.each(["inbox", "social", "planner", "journal", "library"] as const)(
  "uses an inline disclosure and a scoped integration action for %s",
  (appId) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const route = `/apps/${appId}?provider=example&space=space-a`;
    const ui = render(
      <MemoryRouter>
        <DownloadedAppNavigator
          accountId="test"
          appId={appId}
          label={appId}
          active
          activeRoute={route}
          items={[
            { id: "misty", label: "Misty", route: `/apps/${appId}?provider=misty` },
            { id: "integrations", label: "Your sources", route: `/apps/${appId}` },
            { id: "example", label: "Website", route },
          ]}
        />
      </MemoryRouter>,
    );
    expect(ui.queryByText("Your sources")).toBeNull();
    expect(ui.queryByRole("link", { name: "Misty" })).toBeNull();
    expect(ui.queryByRole("link", { name: "Website" })).toBeNull();
    const expand = ui.getByRole("button", { name: appId });
    expect(expand.querySelector("[data-chevron-placement=inline]")).not.toBeNull();
    const action = ui.getByRole("button", { name: `${appId} source: Website` });
    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(action);
    expect(ui.getByRole("button", { name: "Switch to Website" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(ui.getByRole("textbox", { name: `Search ${appId} integrations` })).toBeTruthy();
    expect(ui.queryByRole("button", { name: `Add ${appId} integration` })).toBeNull();
    expect(expand.getAttribute("aria-expanded")).toBe("false");
  },
);

it("selects only the deepest destination when a parent shares its route", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const route = "/apps/planner?view=tasks";
  const ui = render(
    <MemoryRouter>
      <DownloadedAppNavigator
        accountId="test"
        appId="planner"
        label="Planner"
        active
        activeRoute={route}
        items={[
          {
            id: "misty",
            label: "Misty",
            route,
            children: [{ id: "tasks", label: "Tasks", route }],
          },
        ]}
      />
    </MemoryRouter>,
  );
  expect(
    [...ui.container.querySelectorAll('[aria-current="page"]')].map((e) => e.textContent),
  ).toEqual(["Tasks"]);
});
it("uses Files destination glyphs after the downloaded app registers navigation", () => {
  const ui = render(
    <MemoryRouter>
      <DownloadedAppNavigator
        accountId="test"
        appId="files"
        label="Files"
        active
        activeRoute="/apps/files"
        items={[
          { id: "explorer", label: "Explorer", route: "/apps/files" },
          { id: "transfers", label: "Transfers", route: "/apps/files?view=transfers" },
        ]}
      />
    </MemoryRouter>,
  );
  expect(
    ui
      .getByRole("link", { name: "Explorer" })
      .querySelector('[data-navigator-feature-icon="explorer"]'),
  ).not.toBeNull();
  expect(
    ui
      .getByRole("link", { name: "Transfers" })
      .querySelector('[data-navigator-feature-icon="transfers"]'),
  ).not.toBeNull();
});

it("shows only explicit provider pins, behind an independent dropdown", () => {
  const openSurface = vi.spyOn(useWorkspaceStore.getState(), "openSurface").mockClear();
  const ui = render(
    <MemoryRouter>
      <DownloadedAppNavigator
        accountId="pin-test"
        appId="social"
        label="Social"
        active
        activeRoute="/apps/social?provider=instagram"
        items={[
          {
            id: "instagram",
            label: "Instagram",
            route: "/apps/social?provider=instagram",
            children: [
              {
                id: "account-personal",
                label: "Unpinned account",
                route: "/apps/social?provider=instagram&websiteAccount=personal",
              },
              {
                id: "messages",
                label: "Unpinned messages",
                route: "/apps/social?provider=instagram&view=messages",
              },
              {
                id: "pin-friends",
                label: "Friends",
                route: "/apps/social?provider=instagram&pin=friends",
                children: [
                  {
                    id: "pin-family",
                    label: "Family",
                    route: "/apps/social?provider=instagram&pin=family",
                  },
                ],
              },
            ],
          },
          { id: "discord", label: "Discord", route: "/apps/social?provider=discord" },
        ]}
      />
    </MemoryRouter>,
  );
  expect(ui.queryByRole("link", { name: "Friends" })).toBeNull();
  expect(ui.queryByRole("button", { name: "Expand Discord" })).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Instagram" }));
  expect(openSurface).toHaveBeenCalledTimes(1);
  expect(ui.queryByText("Unpinned account")).toBeNull();
  expect(ui.queryByText("Unpinned messages")).toBeNull();
  expect(ui.getByRole("link", { name: "Friends" })).toBeTruthy();
  expect(ui.queryByRole("link", { name: "Family" })).toBeNull();
  fireEvent.click(ui.getByRole("link", { name: "Friends" }));
  const family = ui.getByRole("link", { name: "Family" });
  expect(family.getAttribute("href")).toContain("pin=family");
  fireEvent.click(family);
  expect(openSurface).toHaveBeenCalledTimes(3);
  fireEvent.click(ui.getByRole("button", { name: "Instagram" }));
  expect(ui.queryByRole("link", { name: "Friends" })).toBeNull();
});

it("reveals the selected pin and allows its active parent to be collapsed", () => {
  const route = "/apps/social?provider=instagram&pin=friends";
  const ui = render(
    <MemoryRouter>
      <DownloadedAppNavigator
        accountId="selected-pin-test"
        appId="social"
        label="Social"
        active
        activeRoute={route}
        items={[
          {
            id: "instagram",
            label: "Instagram",
            route: "/apps/social?provider=instagram",
            children: [{ id: "pin-friends", label: "Friends", route }],
          },
        ]}
      />
    </MemoryRouter>,
  );
  expect(ui.getByRole("link", { name: "Friends" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(ui.getByRole("button", { name: "Instagram" }));
  expect(ui.queryByRole("link", { name: "Friends" })).toBeNull();
  expect(ui.getByRole("button", { name: "Instagram" }).getAttribute("aria-current")).toBe("page");
});

it("renders pins as full-size links with an independent, guarded unpin action", async () => {
  const route = "/apps/social?provider=instagram&pin=messages";
  const item = { id: "pin-messages", label: "Messages", route };
  const open = vi.spyOn(useWorkspaceStore.getState(), "openSurface").mockClear();
  const ui = render(
    <MemoryRouter>
      <DownloadedAppNavigator
        accountId="one"
        appId="social"
        label="Social"
        active
        activeRoute={route}
        items={[
          {
            id: "instagram",
            label: "Instagram",
            route: "/apps/social?provider=instagram",
            children: [item],
          },
        ]}
      />
    </MemoryRouter>,
  );
  const link = ui.getByRole("link", { name: "Messages" });
  const button = ui.getByRole("button", { name: "Unpin Messages" });
  expect(link.querySelector(".lucide-link2, .lucide-link-2")).not.toBeNull();
  expect(link.contains(button)).toBe(false);
  expect(link.closest(".group\\/tree-row")?.className).toContain("text-[13px]");
  expect(button.className).toContain("group-hover/tree-row:!opacity-100");
  expect(button.className).toContain("group-focus-within/tree-row:!opacity-100");
  expect(button.getAttribute("data-reorder-ignore")).toBe("true");
  let finish!: () => void;
  vi.mocked(removeNavigatorPin).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button.getAttribute("disabled")).not.toBeNull();
  expect(removeNavigatorPin).toHaveBeenCalledExactlyOnceWith(
    "one",
    "social",
    expect.objectContaining(item),
  );
  expect(open).not.toHaveBeenCalled();
  await act(async () => finish());
  vi.mocked(removeNavigatorPin).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(button);
  await waitFor(() => expect(ui.getByRole("alert").textContent).toContain("Couldn’t unpin"));
  expect(ui.getByRole("link", { name: "Messages" })).toBe(link);
});

it("switches sources from the pill and displays their destinations without a provider branch", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const openSurface = vi.spyOn(useWorkspaceStore.getState(), "openSurface").mockClear();
  const ui = render(
    <MemoryRouter>
      <DownloadedAppNavigator
        accountId="switch-source"
        appId="planner"
        label="Planner"
        active={false}
        activeRoute=""
        items={[
          {
            id: "misty",
            label: "Misty",
            route: "/apps/planner?provider=misty",
            children: [
              { id: "tasks", label: "Tasks", route: "/apps/planner?provider=misty&view=tasks" },
            ],
          },
          {
            id: "notion",
            label: "Notion",
            route: "/apps/planner?provider=notion",
            children: [
              {
                id: "pin-project",
                label: "Project",
                route: "/apps/planner?provider=notion&pin=project",
              },
            ],
          },
        ]}
      />
    </MemoryRouter>,
  );
  fireEvent.click(ui.getByRole("button", { name: "Planner source: Misty" }));
  fireEvent.click(ui.getByRole("button", { name: "Switch to Notion" }));
  expect(openSurface).toHaveBeenCalledWith(expect.objectContaining({ syncExistingRoute: true }));
  expect(ui.getByRole("button", { name: "Planner source: Notion" })).toBeTruthy();
  expect(ui.getByRole("link", { name: "Project" })).toBeTruthy();
  expect(ui.queryByRole("link", { name: "Tasks" })).toBeNull();
  expect(ui.queryByRole("button", { name: "Notion" })).toBeNull();
});

it("searches available integrations, retains errors, and adds without opening the modal", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const openSurface = vi.spyOn(useWorkspaceStore.getState(), "openSurface").mockClear();
  const ui = render(
    <MemoryRouter>
      <DownloadedAppNavigator
        accountId="add-source"
        appId="planner"
        label="Planner"
        active={false}
        activeRoute=""
        items={[{ id: "misty", label: "Misty", route: "/apps/planner?provider=misty" }]}
      />
    </MemoryRouter>,
  );
  fireEvent.click(ui.getByRole("button", { name: "Planner source: Misty" }));
  const search = ui.getByRole("textbox", { name: "Search Planner integrations" });
  fireEvent.change(search, { target: { value: "no-such-integration" } });
  expect(ui.getByText("No integrations found.")).toBeTruthy();
  fireEvent.change(search, { target: { value: "todoist" } });
  expect(ui.queryByRole("button", { name: "Switch to Misty" })).toBeNull();
  vi.mocked(addNavigatorIntegration).mockRejectedValueOnce(
    new Error("Couldn’t add integration. Try again."),
  );
  fireEvent.click(ui.getByRole("button", { name: "Add Todoist" }));
  await waitFor(() => expect(ui.getByRole("alert").textContent).toContain("Try again"));
  expect(openSurface).not.toHaveBeenCalled();
  fireEvent.click(ui.getByRole("button", { name: "Add Todoist" }));
  await waitFor(() => expect(ui.queryByRole("textbox")).toBeNull());
  expect(addNavigatorIntegration).toHaveBeenLastCalledWith("add-source", "planner", "todoist");
  expect(openSurface).toHaveBeenCalledWith(expect.objectContaining({ syncExistingRoute: true }));
  expect(ui.getByRole("button", { name: "Planner source: Todoist" })).toBeTruthy();
});

it.each([
  ["inbox", "google"],
  ["social", "instagram"],
  ["planner", "todoist"],
  ["journal", "notion"],
  ["library", "google-drive"],
] as const)("shows only the selected %s integration's pins", (appId, provider) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const route = `/apps/${appId}?provider=${provider}`;
  const ui = render(
    <MemoryRouter>
      <DownloadedAppNavigator
        accountId={`pins-${appId}`}
        appId={appId}
        label={appId}
        active
        activeRoute={route}
        items={[
          {
            id: "misty",
            label: "Misty",
            route: `/apps/${appId}?provider=misty`,
            children: [
              {
                id: "tasks",
                label: "Misty tasks",
                route: `/apps/${appId}?provider=misty&view=tasks`,
              },
            ],
          },
          {
            id: provider,
            label: "Selected integration",
            route,
            children: [
              { id: "inbox", label: "Old subsection", route: `${route}&view=inbox` },
              { id: "pin-saved", label: "Saved page", route: `${route}&pin=saved` },
            ],
          },
          {
            id: "other",
            label: "Other integration",
            route: `/apps/${appId}?provider=other`,
            children: [
              {
                id: "pin-other",
                label: "Other pin",
                route: `/apps/${appId}?provider=other&pin=other`,
              },
            ],
          },
        ]}
      />
    </MemoryRouter>,
  );
  expect(ui.getByRole("link", { name: "Saved page" })).toBeTruthy();
  expect(ui.queryByText("Old subsection")).toBeNull();
  expect(ui.queryByText("Misty tasks")).toBeNull();
  expect(ui.queryByText("Other pin")).toBeNull();
  expect(ui.queryByText("Starred")).toBeNull();
});
