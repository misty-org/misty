import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace";
import { WebsiteGroupsManager } from "./WebsiteGroupsManager";
import { createWebsiteGroup } from "./navigation";
import { groupIcons } from "./groupIcons";
const { readIcon } = vi.hoisted(() => ({ readIcon: vi.fn() }));
vi.mock("./groupIconUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./groupIconUpload")>()),
  readGroupIcon: readIcon,
}));
beforeEach(() => {
  readIcon.mockReset();
  useWorkspaceStore.getState().reset();
  createWebsiteGroup("Reading");
  createWebsiteGroup("Work");
});
afterEach(cleanup);
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const fill = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
it("switches groups without back navigation and persists a searchable icon choice", () => {
  render(<WebsiteGroupsManager />);
  click("Work");
  expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  expect(Object.keys(groupIcons).length).toBeGreaterThan(50);
  click("Choose group icon");
  fill("Search group icons", "rocket");
  click("rocket");
  expect(
    useWorkspaceStore.getState().websiteGroups.find((group) => group.fields.label === "Work")
      ?.fields.icon,
  ).toBe("rocket");
});
it("creates a group, adds and renames a site, and deletes the selected group", () => {
  render(<WebsiteGroupsManager />);
  click("Add group");
  fill("New group name", "Research");
  click("Add");
  click("Add site to group");
  fill("Site URL", "example.com");
  fill("Site name (optional)", "Example");
  click("Add site");
  click("Edit Example");
  fill("Site name", "Reference");
  click("Save site name");
  expect(useWorkspaceStore.getState().savedWebsites[0].fields.title).toBe("Reference");
  click("Delete group");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  click("Delete");
  expect(useWorkspaceStore.getState().savedWebsites).toHaveLength(0);
  expect(
    useWorkspaceStore.getState().websiteGroups.some((group) => group.fields.label === "Research"),
  ).toBe(false);
  expect(screen.getByRole("button", { name: "Choose group icon" })).toBeTruthy();
});
it("rejects invalid URLs without losing the add form", () => {
  render(<WebsiteGroupsManager />);
  click("Add site to group");
  fill("Site URL", "not a url");
  click("Add site");
  expect(screen.getByRole("alert").textContent).toContain("Enter a website address");
  expect(useWorkspaceStore.getState().savedWebsites).toHaveLength(0);
});

it("keeps groups and sites until deletion is confirmed", () => {
  render(<WebsiteGroupsManager />);
  const before = useWorkspaceStore.getState().websiteGroups;
  click("Delete group");
  expect(useWorkspaceStore.getState().websiteGroups).toEqual(before);
  click("Cancel");
  expect(useWorkspaceStore.getState().websiteGroups).toEqual(before);
  click("Edit group name");
  expect(screen.getByRole("dialog", { name: "Edit group" })).toBeTruthy();
  fill("Group name", "Discarded");
  click("Cancel editing");
  expect(useWorkspaceStore.getState().websiteGroups).toEqual(before);
  click("Add group");
  expect(screen.getByRole("dialog", { name: "Add group" })).toBeTruthy();
  click("Cancel");
  expect(useWorkspaceStore.getState().websiteGroups).toEqual(before);
});

it("starts with no suggestions and lets users create their first group", () => {
  useWorkspaceStore.getState().reset();
  render(<WebsiteGroupsManager />);
  expect(screen.queryByText("Suggested groups")).toBeNull();
  expect(screen.queryByText("Discover sites")).toBeNull();
  expect(useWorkspaceStore.getState().websiteGroups).toEqual([]);
  click("Add group");
  fill("New group name", "My bookmarks");
  click("Add");
  expect(useWorkspaceStore.getState().websiteGroups[0].fields.label).toBe("My bookmarks");
  expect(screen.getByRole("button", { name: "Choose group icon" })).toBeTruthy();
});

it("stores an uploaded icon and lets a built-in icon replace it", async () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=";
  readIcon.mockResolvedValue(png);
  render(<WebsiteGroupsManager />);
  click("Choose group icon");
  fireEvent.change(screen.getByLabelText("Upload group icon"), {
    target: { files: [new File(["png"], "icon.png", { type: "image/png" })] },
  });
  await waitFor(() => expect(useWorkspaceStore.getState().websiteGroups[0].fields.icon).toBe(png));
  click("Choose group icon");
  click("rocket");
  expect(useWorkspaceStore.getState().websiteGroups[0].fields.icon).toBe("rocket");
});

it("keeps the previous icon when an upload fails", async () => {
  readIcon.mockRejectedValue(new Error("This image could not be opened. Try another file."));
  render(<WebsiteGroupsManager />);
  click("Choose group icon");
  fireEvent.change(screen.getByLabelText("Upload group icon"), {
    target: { files: [new File(["bad"], "icon.png", { type: "image/png" })] },
  });
  expect((await screen.findByRole("alert")).textContent).toContain("could not be opened");
  expect(useWorkspaceStore.getState().websiteGroups[0].fields.icon).toBe("globe");
});
