import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as Settings from "@/features/settings";
import { ExtensionsWorkspace } from "./ExtensionsWorkspace";
import { extensionsNative } from "./native";
import { useExtensionsStore } from "./store";
import type { CatalogEntry, CatalogPage } from "./types";

vi.mock("./native", () => ({
  extensionsNative: { categories: vi.fn(), search: vi.fn(), detail: vi.fn() },
}));
vi.mock("@/features/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof Settings>()),
  useSettingsProfiles: (select: (state: unknown) => unknown) =>
    select({ state: {}, ready: true, accountId: "test" }),
  resolveSetting: (_state: unknown, key: string) => ({
    value: key === "extensions.view" ? "grid" : key === "extensions.installations" ? "[]" : true,
  }),
}));
vi.mock("@/features/settings/AccountCollectionFilters", async () => {
  const { CollectionFilters } = await import("@/shared/ui");
  return { AccountCollectionFilters: CollectionFilters };
});

const entry: CatalogEntry = {
  id: 1,
  guid: "onetab",
  slug: "onetab",
  name: "OneTab",
  summary: "Save memory and reduce tab clutter",
  description: "Collect your tabs in a list.",
  authors: ["OneTab Team"],
  iconUrl: "",
  version: "2.20",
  users: 100,
  rating: 4,
  sourceUrl: "",
  downloadUrl: "",
  digest: "",
};
function Location() {
  const location = useLocation();
  return (
    <output data-testid="route">
      {location.pathname}
      {location.search}
    </output>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  useExtensionsStore.setState({ ready: true, supported: true, states: [], error: "" });
  vi.mocked(extensionsNative.categories).mockResolvedValue([{ id: "tabs", name: "Tabs" }]);
});
afterEach(cleanup);

it("shows matching skeletons and returns from details to the originating category", async () => {
  let resolveCatalog!: (value: CatalogPage) => void;
  let resolveDetail!: (value: CatalogEntry) => void;
  vi.mocked(extensionsNative.search).mockReturnValue(
    new Promise((resolve) => {
      resolveCatalog = resolve;
    }),
  );
  vi.mocked(extensionsNative.detail).mockReturnValue(
    new Promise((resolve) => {
      resolveDetail = resolve;
    }),
  );
  render(
    <MemoryRouter initialEntries={["/extensions?category=tabs"]}>
      <ExtensionsWorkspace />
      <Location />
    </MemoryRouter>,
  );
  const loading = await screen.findByRole("status", { name: "Loading Firefox Add-ons" });
  expect(loading.querySelectorAll('[data-slot="card"]').length).toBe(12);
  expect(screen.queryByText("No extensions found. Try another search.")).toBeNull();
  await act(async () => resolveCatalog({ entries: [entry], count: 1, hasMore: false }));
  fireEvent.click(await screen.findByRole("button", { name: "OneTab" }));
  expect(await screen.findByRole("status", { name: "Loading extension" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  await waitFor(() => expect(extensionsNative.detail).toHaveBeenCalledWith(1));
  await act(async () => resolveDetail(entry));
  expect(await screen.findByRole("heading", { name: "OneTab" })).toBeTruthy();
  expect(screen.queryByRole("status", { name: "Loading extension" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByTestId("route").textContent).toBe("/extensions?category=tabs");
  expect(await screen.findByRole("button", { name: "OneTab" })).toBeTruthy();
});

it("shows a skeleton while the native runtime initializes instead of an empty catalog", () => {
  useExtensionsStore.setState({ ready: false, supported: false });
  render(
    <MemoryRouter initialEntries={["/extensions"]}>
      <ExtensionsWorkspace />
    </MemoryRouter>,
  );
  expect(screen.getByRole("status", { name: "Loading Firefox Add-ons" })).toBeTruthy();
  expect(screen.queryByText("No extensions found. Try another search.")).toBeNull();
  expect(extensionsNative.search).not.toHaveBeenCalled();
});
