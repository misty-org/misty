import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Inbox, Settings } from "lucide-react";

import {
  EmptyState,
  FormSection,
  IconButton,
  PageBody,
  PageHeader,
  PageShell,
  SidebarNav,
  SidebarNavItem,
  SidebarNavSection,
} from ".";

describe("Misty component contracts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("provides one consistent page landmark and action area", async () => {
    await act(async () => {
      root.render(
        <PageShell>
          <PageHeader title="Library" description="Design team" actions={<button type="button">Upload</button>} />
          <PageBody>Items</PageBody>
        </PageShell>,
      );
    });

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Library");
    expect(container.querySelector("header button")?.textContent).toBe("Upload");
    expect(container.querySelector('[data-slot="page-body"]')?.textContent).toBe("Items");
  });

  it("exposes labeled navigation and the active destination", async () => {
    await act(async () => {
      root.render(
        <SidebarNav label="Space destinations">
          <SidebarNavSection label="Workspace">
            <SidebarNavItem icon={<Settings />} active>Settings</SidebarNavItem>
            <SidebarNavItem>Members</SidebarNavItem>
          </SidebarNavSection>
        </SidebarNav>,
      );
    });

    expect(container.querySelector('nav[aria-label="Space destinations"]')).not.toBeNull();
    expect(container.querySelector('button[aria-current="page"]')?.textContent).toContain("Settings");
    expect(container.querySelectorAll('button[aria-current="page"]')).toHaveLength(1);
  });

  it("keeps icon controls and empty states accessible", async () => {
    await act(async () => {
      root.render(
        <>
          <IconButton label="Open settings" tooltip={false}><Settings /></IconButton>
          <EmptyState icon={<Inbox />} title="No items" description="Upload a file to begin." />
        </>,
      );
    });

    expect(container.querySelector('button[aria-label="Open settings"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="empty-state"] h2')?.textContent).toBe("No items");
    expect(container.textContent).toContain("Upload a file to begin.");
  });

  it("labels form sections with their visible heading", async () => {
    await act(async () => {
      root.render(
        <FormSection title="Profile" description="Public account details">
          <input aria-label="Display name" />
        </FormSection>,
      );
    });

    const fieldset = container.querySelector("fieldset");
    const heading = container.querySelector("fieldset h2");
    expect(heading?.id).toBeTruthy();
    expect(fieldset?.getAttribute("aria-labelledby")).toBe(heading?.id);
  });
});
