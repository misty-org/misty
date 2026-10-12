import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  agentsDeviceSnapshot: vi.fn(),
  codeCheckpoints: vi.fn(),
  codeChooseProject: vi.fn(),
  codeAllowProjectChanges: vi.fn(),
  codeRemoveProject: vi.fn(),
  codeSetProjectInstalls: vi.fn(),
  codeUndo: vi.fn(),
}));
vi.mock("../store/useAgentsStore", () => store);
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));

import { CodeProjectsSection, useCodeProjects } from "./CodeProjects";

function Harness() {
  return <CodeProjectsSection projects={useCodeProjects()} />;
}

const project = {
  id: "scope_site",
  deviceId: "device_1",
  displayName: "bakery-site",
  kind: "project_folder" as const,
  allowInstalls: false,
  available: true,
};

beforeEach(() => {
  store.agentsDeviceSnapshot.mockResolvedValue({
    version: 2,
    device: null,
    loadedAt: "",
    scopes: [
      project,
      // Shared read-only before projects existed.
      {
        id: "scope_docs",
        deviceId: "device_1",
        displayName: "Docs",
        kind: "local_folder",
        available: true,
      },
    ],
  });
  store.codeCheckpoints.mockResolvedValue([
    { runId: "invocation_1", createdAt: 1_760_000_000, complete: true, files: 4 },
    { runId: "invocation_0", createdAt: 1_759_000_000, complete: false, files: 0 },
  ]);
  store.codeSetProjectInstalls.mockResolvedValue(undefined);
  store.codeUndo.mockResolvedValue({ restored: 3, removed: 1 });
  store.codeRemoveProject.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("lists projects with their install switch and undoable chats", async () => {
  render(<Harness />);
  expect(await screen.findByText("bakery-site")).toBeTruthy();
  expect(screen.getAllByRole("switch")).toHaveLength(1);
  const installs = screen.getByRole("switch", { name: "Allow package installs in bakery-site" });
  expect(installs.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText(/could be sent out through those sites/)).toBeTruthy();
  const undos = screen.getAllByRole("button", { name: /Undo changes to bakery-site/ });
  expect(undos).toHaveLength(2);
  expect((undos[1] as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Too large to undo/)).toBeTruthy();
});

it("turns package installs on for that project only", async () => {
  render(<Harness />);
  fireEvent.click(
    await screen.findByRole("switch", { name: "Allow package installs in bakery-site" }),
  );
  await waitFor(() =>
    expect(store.codeSetProjectInstalls).toHaveBeenCalledWith("scope_site", true),
  );
});

it("undoes one chat's changes and says so", async () => {
  render(<Harness />);
  const [undo] = await screen.findAllByRole("button", { name: /Undo changes to bakery-site/ });
  fireEvent.click(undo!);
  await waitFor(() => expect(store.codeUndo).toHaveBeenCalledWith("scope_site", "invocation_1"));
  expect(await screen.findByText(/Undid the changes to bakery-site/)).toBeTruthy();
});

it("shows the native reason when a folder can't be a project", async () => {
  store.codeChooseProject.mockRejectedValue("System folders can't be projects.");
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: /Add a project/ }));
  expect(await screen.findByText("System folders can't be projects.")).toBeTruthy();
});

it("removes a project", async () => {
  render(<Harness />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Stop sharing bakery-site as a project" }),
  );
  await waitFor(() => expect(store.codeRemoveProject).toHaveBeenCalledWith("scope_site"));
});

it("lists folders shared read-only before projects until the person allows changes", async () => {
  store.codeAllowProjectChanges.mockResolvedValue(undefined);
  render(<Harness />);
  expect(await screen.findByText("Docs")).toBeTruthy();
  expect(screen.getByText("Read only")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Allow agents to change Docs" }));
  await waitFor(() => expect(store.codeAllowProjectChanges).toHaveBeenCalledWith("scope_docs"));
  expect(await screen.findByText("Agents can now change Docs.")).toBeTruthy();
});
