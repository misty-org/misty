import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountCollectionFilters, orderedTabs, mergeTabOrder } from "./AccountCollectionFilters";
import { useSettingsProfiles } from "./profiles/store";
import { initialProfileState, editPreference } from "./profiles/model";
const initial = useSettingsProfiles.getState();
const options = [
  { value: "all", label: "All" },
  { value: "notes", label: "Notes" },
  { value: "drawings", label: "Drawings" },
];
const edit = vi.fn(async (id: string, value: string) => {
  useSettingsProfiles.setState((store) => ({
    state: editPreference(store.state!, id, value, crypto.randomUUID()),
  }));
});
beforeEach(() => {
  useSettingsProfiles.setState({
    accountId: "first",
    ready: true,
    state: initialProfileState({}),
    edit,
  });
});
afterEach(() => {
  cleanup();
  useSettingsProfiles.setState(initial);
  vi.clearAllMocks();
});
const tabNames = () =>
  within(screen.getByRole("navigation", { name: "Filter items" }))
    .getAllByRole("button")
    .map((tab) => tab.textContent);
it("moves a tab without selecting it, persists across remounts, and isolates accounts", async () => {
  const select = vi.fn();
  const ui = render(
    <AccountCollectionFilters
      collectionId="journal"
      options={options}
      value="all"
      onChange={select}
    />,
  );
  const drawings = screen.getByRole("button", { name: "Drawings" });
  drawings.focus();
  fireEvent.keyDown(drawings, { key: "ArrowLeft", altKey: true, shiftKey: true });
  await waitFor(() => expect(tabNames()).toEqual(["All", "Drawings", "Notes"]));
  expect(edit).toHaveBeenCalledWith("collections.tabs.journal", '["all","drawings","notes"]');
  expect(select).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(drawings);
  ui.unmount();
  render(
    <AccountCollectionFilters
      collectionId="journal"
      options={options}
      value="notes"
      onChange={select}
    />,
  );
  expect(tabNames()).toEqual(["All", "Drawings", "Notes"]);
  act(() => useSettingsProfiles.setState({ accountId: "second", state: initialProfileState({}) }));
  expect(tabNames()).toEqual(["All", "Notes", "Drawings"]);
});
it("keeps new and temporarily hidden tabs without duplicates", () => {
  expect(orderedTabs(options, '["drawings","hidden","drawings"]')).toEqual([
    options[2],
    options[0],
    options[1],
  ]);
  expect(
    mergeTabOrder('["all","hidden","notes","drawings"]', ["drawings", "all", "notes"]),
  ).toEqual(["drawings", "hidden", "all", "notes"]);
  expect(orderedTabs(options, "invalid")).toEqual(options);
});
it("reports a failed save and keeps the last saved order", async () => {
  useSettingsProfiles.setState({ edit: vi.fn().mockRejectedValue(new Error("Disk unavailable")) });
  render(
    <AccountCollectionFilters
      collectionId="journal"
      options={options}
      value="all"
      onChange={vi.fn()}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Notes" }), {
    key: "ArrowLeft",
    altKey: true,
    shiftKey: true,
  });
  expect((await screen.findByRole("alert")).textContent).toContain("Tab order couldn’t be saved");
  expect(tabNames()).toEqual(["All", "Notes", "Drawings"]);
});
