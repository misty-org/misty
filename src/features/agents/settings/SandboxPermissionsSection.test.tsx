// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  set: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/native/sandbox", () => ({
  downloadsGrantId: "grant-downloads",
  sandboxPermissionsList: mocks.list,
  sandboxPermissionSet: mocks.set,
}));
vi.mock("@/shared/lib/confirmAction", () => ({ confirmAction: mocks.confirm }));

import { SandboxPermissionsSection } from "./SandboxPermissionsSection";

const rows = (downloads: boolean) => [
  { id: "permission-screen-capture", label: "See your screen", on: false },
  { id: "grant-downloads", label: "Downloads folder", on: downloads },
];

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(rows(true));
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

test("a switch turns a permission on", async () => {
  render(<SandboxPermissionsSection />);
  fireEvent.click(await screen.findByRole("switch", { name: "See your screen" }));
  await waitFor(() => expect(mocks.set).toHaveBeenCalledWith("permission-screen-capture", true));
});

test("the Downloads grant can be revoked after confirming", async () => {
  render(<SandboxPermissionsSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(mocks.set).toHaveBeenCalledWith("grant-downloads", false));
});

test("declining the confirmation keeps the Downloads grant", async () => {
  mocks.confirm.mockResolvedValue(false);
  render(<SandboxPermissionsSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  expect(mocks.set).not.toHaveBeenCalled();
});

test("the Downloads row only shows once there's something to revoke", async () => {
  mocks.list.mockResolvedValue(rows(false));
  render(<SandboxPermissionsSection />);
  await screen.findByRole("switch", { name: "See your screen" });
  expect(screen.queryByText("Downloads folder")).toBeNull();
});
