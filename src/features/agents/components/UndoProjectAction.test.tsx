import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  agentsDeviceSnapshot: vi.fn(async () => ({
    scopes: [{ id: "scope_site", displayName: "site", kind: "project_folder", available: true }],
  })),
  codeCheckpoints: vi.fn(async () => [
    { runId: "invocation_7", createdAt: 1, complete: true, files: 3 },
  ]),
  codeUndo: vi.fn(async () => ({ restored: 2, removed: 1 })),
}));
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../store/useAgentsStore", () => store);
vi.mock("@/shared/lib/confirmAction", () => ({ confirmAction: confirm }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));

import { changedProject, UndoProjectAction } from "./UndoProjectAction";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("knows which runs changed a project", () => {
  const tool = (name: string) => ({
    type: "tool" as const,
    id: name,
    name,
    state: "completed" as const,
  });
  expect(changedProject([tool("code.read"), tool("code.search")])).toBe(false);
  expect(changedProject([tool("code.read"), tool("code_edit")])).toBe(true);
  expect(changedProject([tool("code.run")])).toBe(true);
  expect(changedProject(undefined)).toBe(false);
});

it("undoes the run's changes after the person confirms", async () => {
  render(<UndoProjectAction runId="invocation_7" />);
  fireEvent.click(await screen.findByRole("button", { name: "Undo changes to site" }));
  await waitFor(() => expect(store.codeUndo).toHaveBeenCalledWith("scope_site", "invocation_7"));
  expect(await screen.findByRole("button", { name: "Changes to site undone" })).toBeTruthy();
});

it("changes nothing when the person cancels", async () => {
  confirm.mockResolvedValueOnce(false);
  render(<UndoProjectAction runId="invocation_7" />);
  fireEvent.click(await screen.findByRole("button", { name: "Undo changes to site" }));
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  expect(store.codeUndo).not.toHaveBeenCalled();
});

it("shows nothing for a run with no undo copy", async () => {
  render(<UndoProjectAction runId="invocation_other" />);
  await waitFor(() => expect(store.codeCheckpoints).toHaveBeenCalled());
  expect(screen.queryByRole("button")).toBeNull();
});
