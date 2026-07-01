import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace";
import { WebsiteIntegrationPicker } from "./WebsiteIntegrationPicker";
import { addWebsite, removeWebsiteGroup } from "./navigation";

beforeEach(() => useWorkspaceStore.getState().reset());
afterEach(cleanup);
function setup(initialGroupId?: string) {
  const state = useWorkspaceStore.getState();
  const onDone = vi.fn();
  render(
    <WebsiteIntegrationPicker
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
describe("Groups picker", () => {
  it("chooses a destination before adding an integration", () => {
    const { onDone } = setup();
    click("Gmail");
    expect(useWorkspaceStore.getState().savedWebsites).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Add to group" })).toBeTruthy();
    click("Social");
    expect(useWorkspaceStore.getState().savedWebsites[0].fields).toMatchObject({
      group_id: "group:default:social",
      title: "Gmail",
      url: "https://mail.google.com/mail/u/0/#inbox",
    });
    expect(onDone).toHaveBeenCalledOnce();
  });
  it("searches both presets and integrations", () => {
    setup();
    fill("Search groups and integrations", "Journal");
    expect(screen.getByRole("button", { name: "Edit Journal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gmail" })).toBeNull();
    fill("Search groups and integrations", "Notion");
    click("Notion");
    click("Journal");
    expect(useWorkspaceStore.getState().savedWebsites[0].fields.title).toBe("Notion");
  });
  it("routes a custom url through group selection", () => {
    setup();
    fill("Search groups and integrations", "example.com");
    click("Add custom url");
    expect((screen.getByRole("textbox", { name: "URL" }) as HTMLInputElement).value).toBe(
      "https://example.com/",
    );
    click("Add to group");
    click("Library");
    expect(useWorkspaceStore.getState().savedWebsites[0].fields).toMatchObject({
      url: "https://example.com/",
      group_id: "group:default:library",
    });
  });
  it("creates a new destination with its pending integration", () => {
    setup();
    click("Notion");
    click("Create group");
    fill("Group name", "Research");
    click("Create group");
    const state = useWorkspaceStore.getState();
    const group = state.websiteGroups.find((group) => group.fields.label === "Research")!;
    expect(state.savedWebsites[0].fields.group_id).toBe(group.id);
    expect(state.savedWebsites[0].fields.title).toBe("Notion");
  });
  it("customizes a preset without adding every suggestion", () => {
    removeWebsiteGroup("group:default:inbox");
    setup();
    click("Customize Inbox");
    fill("Group name", "Mail");
    fireEvent.click(screen.getByRole("checkbox", { name: "Gmail" }));
    click("Create group");
    const state = useWorkspaceStore.getState();
    expect(state.savedWebsites).toHaveLength(1);
    expect(state.websiteGroups.find((group) => group.fields.label === "Mail")?.fields.icon).toBe(
      "mail",
    );
  });
  it("edits group names and contents while preserving retained site identities", () => {
    const keep = addWebsite(
      "group:default:inbox",
      "Gmail",
      "https://mail.google.com/mail/u/0/#inbox",
    );
    addWebsite("group:default:inbox", "Example", "https://example.com/");
    setup("group:default:inbox");
    fill("Group name", "Personal mail");
    fireEvent.click(screen.getByRole("checkbox", { name: "Example" }));
    click("Save changes");
    const state = useWorkspaceStore.getState();
    expect(state.savedWebsites.map((site) => site.id)).toEqual([keep]);
    expect(state.websiteGroups[0].fields.label).toBe("Personal mail");
  });
  it("does not duplicate a destination already in a group", () => {
    const id = addWebsite("group:default:inbox", "Mail", "https://mail.google.com/mail/u/0/#inbox");
    setup();
    click("Gmail");
    click("Inbox");
    expect(useWorkspaceStore.getState().savedWebsites.map((site) => site.id)).toEqual([id]);
  });
  it("shows an error for an invalid url without advancing", () => {
    setup();
    click("Add custom url");
    fill("URL", "not an address");
    click("Add to group");
    expect(screen.getByRole("alert").textContent).toContain("Enter a website address");
    expect(useWorkspaceStore.getState().savedWebsites).toHaveLength(0);
  });
});
