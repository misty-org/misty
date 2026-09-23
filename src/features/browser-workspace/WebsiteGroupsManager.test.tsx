import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useWorkspaceStore } from "@/features/workspace";
import { WebsiteGroupsManager } from "./WebsiteGroupsManager";
import { groupIcons } from "./groupIcons";
beforeEach(() => useWorkspaceStore.getState().reset());
afterEach(cleanup);
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const fill = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
it("switches groups without back navigation and persists a searchable icon choice", () => {
  render(<WebsiteGroupsManager />);
  click("Social");
  expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  expect(Object.keys(groupIcons).length).toBeGreaterThan(50);
  click("Choose group icon");
  fill("Search group icons", "rocket");
  click("rocket");
  expect(
    useWorkspaceStore.getState().websiteGroups.find((group) => group.fields.label === "Social")
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
