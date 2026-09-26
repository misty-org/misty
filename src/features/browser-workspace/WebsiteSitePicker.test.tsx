import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace";
import { WebsiteSitePicker } from "./WebsiteSitePicker";
import { addWebsite } from "./navigation";

beforeEach(() => {
  useWorkspaceStore.getState().reset();
  useWorkspaceStore.setState({
    websiteGroups: ["Inbox", "Social", "Journal", "Planner", "Library"].map((label, order) => ({
      kind: "group",
      id: `group:test:${label.toLowerCase()}`,
      fields: { label, icon: "globe", order, hidden: false },
    })),
  });
});
afterEach(cleanup);
function setup(initialGroupId?: string) {
  const state = useWorkspaceStore.getState();
  const onDone = vi.fn();
  render(
    <WebsiteSitePicker
      groups={state.websiteGroups}
      websites={state.savedWebsites}
      initialGroupId={initialGroupId}
      onDone={onDone}
    />,
  );
  return { onDone };
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const fill = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
describe("Sites picker", () => {
  it("chooses a destination before adding an site", () => {
    const { onDone } = setup();
    click("Add Gmail");
    expect(useWorkspaceStore.getState().savedWebsites).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Add to group" })).toBeTruthy();
    click("Add to Social");
    expect(useWorkspaceStore.getState().savedWebsites[0].fields).toMatchObject({
      group_id: "group:test:social",
      title: "Gmail",
      url: "https://mail.google.com/mail/u/0/#inbox",
    });
    expect(onDone).toHaveBeenCalledOnce();
  });
  it("searches sites without mixing in groups", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Edit Journal" })).toBeNull();
    fill("Search sites or paste a URL", "Journal");
    expect(screen.getByText("No sites")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Gmail" })).toBeNull();
    fill("Search sites or paste a URL", "Notion");
    click("Add Notion");
    click("Add to Journal");
    expect(useWorkspaceStore.getState().savedWebsites[0].fields.title).toBe("Notion");
  });
  it("routes a custom url through group selection", () => {
    setup();
    fill("Search sites or paste a URL", "example.com");
    click("Add custom URL");
    expect((screen.getByRole("textbox", { name: "URL" }) as HTMLInputElement).value).toBe(
      "https://example.com/",
    );
    click("Add");
    click("Add to Library");
    expect(useWorkspaceStore.getState().savedWebsites[0].fields).toMatchObject({
      url: "https://example.com/",
      group_id: "group:test:library",
    });
  });
  it("creates a new destination with its pending site", () => {
    setup();
    click("Add Notion");
    fill("New group name", "Research");
    click("Add");
    const state = useWorkspaceStore.getState();
    const group = state.websiteGroups.find((group) => group.fields.label === "Research")!;
    expect(state.savedWebsites[0].fields.group_id).toBe(group.id);
    expect(state.savedWebsites[0].fields.title).toBe("Notion");
  });
  it("edits group names and contents while preserving retained site identities", () => {
    const keep = addWebsite("group:test:inbox", "Gmail", "https://mail.google.com/mail/u/0/#inbox");
    addWebsite("group:test:inbox", "Example", "https://example.com/");
    setup("group:test:inbox");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Group name" })).toBeNull();
    click("Edit group name");
    fill("Group name", "Personal mail");
    click("Save group name");
    click("Delete Example");
    click("Delete");
    const state = useWorkspaceStore.getState();
    expect(state.savedWebsites.map((site) => site.id)).toEqual([keep]);
    expect(state.websiteGroups[0].fields.label).toBe("Personal mail");
  });
  it("renames sites inline and deletes the group", () => {
    const id = addWebsite("group:test:inbox", "Example", "https://example.com/");
    const { onDone } = setup("group:test:inbox");
    click("Edit Example");
    fill("Site name", "Reference");
    click("Save site name");
    expect(useWorkspaceStore.getState().savedWebsites[0]).toMatchObject({
      id,
      fields: { title: "Reference" },
    });
    click("Delete group");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    click("Delete");
    expect(
      useWorkspaceStore.getState().websiteGroups.some((group) => group.id === "group:test:inbox"),
    ).toBe(false);
    expect(useWorkspaceStore.getState().savedWebsites).toHaveLength(0);
    expect(onDone).toHaveBeenCalledOnce();
  });
  it("cancels inline changes and provides a labeled back button", () => {
    setup("group:test:inbox");
    click("Edit group name");
    fill("Group name", "Discard this");
    click("Cancel editing");
    expect(useWorkspaceStore.getState().websiteGroups[0].fields.label).toBe("Inbox");
    expect(screen.getByRole("button", { name: "Back to sites" }).textContent).toContain("Back");
    click("Back to sites");
    expect(screen.getByRole("textbox", { name: "Search sites or paste a URL" })).toBeTruthy();
  });
  it("does not duplicate a destination already in a group", () => {
    const id = addWebsite("group:test:inbox", "Mail", "https://mail.google.com/mail/u/0/#inbox");
    setup();
    click("Add Gmail");
    click("Add to Inbox");
    expect(useWorkspaceStore.getState().savedWebsites.map((site) => site.id)).toEqual([id]);
  });
  it("shows an error for an invalid url without advancing", () => {
    setup();
    click("Add custom URL");
    fill("URL", "not an address");
    click("Add");
    expect(screen.getByRole("alert").textContent).toContain("Enter a website address");
    expect(useWorkspaceStore.getState().savedWebsites).toHaveLength(0);
  });
});
