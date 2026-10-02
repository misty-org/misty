import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { NativeSyncView } from "./native";
import { DeviceWebsiteDataList } from "./DeviceWebsiteDataList";

afterEach(cleanup);

function session(): NativeSyncView {
  return {
    session_id: "s",
    account_id: "a",
    device_id: "here",
    deployment: "",
    vault_id: "",
    profile_id: "",
    status: {
      phase: "ready",
      applied_sequence: 1,
      head_sequence: 1,
      pending_changes: 0,
      issue: null,
    },
    presence: [],
    pending_operation_ids: [],
    devices: [
      {
        device_id: "here",
        display_name: "Studio Mac",
        platform: "macos",
        control_version: 1,
        full_sync: true,
      },
      {
        device_id: "laptop",
        display_name: "Laptop",
        platform: "windows",
        control_version: 1,
        full_sync: true,
      },
    ],
    workspace: {
      version: 1,
      sequence: 1,
      active_device: null,
      records: [],
      resumes: {},
      orphaned_view_ids: [],
      orphaned_bookmark_ids: [],
    },
    sync: {
      device_id: "here",
      shared_workspace_id: "shared",
      driving_workspace: "laptop",
      workspaces: [],
      contents: {},
      pending: [],
      displaced_with_edits: false,
      seat_confirmed: true,
    },
    website_data: [
      {
        device_id: "here",
        state: "synced",
        checked_at: 1,
        sites: [{ site: "own.test", synced: [{ kind: "cookies", count: 2 }], skipped: [] }],
      },
      {
        device_id: "laptop",
        state: "loading",
        checked_at: 2,
        sites: [
          {
            site: "mail.test",
            synced: [],
            skipped: [{ kind: "indexed_db", reason: "too_large", count: 1 }],
          },
        ],
      },
    ],
  };
}

it("lists each device's own website data, the device written here first", () => {
  const { container } = render(<DeviceWebsiteDataList session={session()} />);
  const sections = [...container.querySelectorAll("[data-device-website-data]")];
  expect(screen.getByRole("region", { name: "Website data on Laptop" })).toBeTruthy();
  expect(sections.map((section) => section.getAttribute("data-device-website-data"))).toEqual([
    "laptop",
    "here",
  ]);
  expect(sections[0].textContent).toContain(
    "Laptop · in use here · Loading this device’s sign-ins",
  );
  expect(sections[0].textContent).toContain("Not synced · 1 database: too large to sync");
  expect(sections[1].textContent).toContain("Studio Mac");
  expect(sections[1].textContent).toContain("Up to date");
});

it("shows nothing before any device has been captured", () => {
  const empty = { ...session(), website_data: [] };
  const { container } = render(<DeviceWebsiteDataList session={empty} />);
  expect(container.textContent).toBe("");
});
