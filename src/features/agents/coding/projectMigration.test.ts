import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), apiRequest: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/api/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  apiRequest: mocks.apiRequest,
}));
import { ApiRequestError } from "@/api/client";
import { legacyActions, migrateProjectSwitches } from "./projectMigration";

beforeEach(() => vi.resetAllMocks());

it("maps old switches to remembered approvals; pushes need a known remote", () => {
  const flags = { scopeId: "scope_a", allowInstalls: true, allowPush: true };
  expect(legacyActions(flags, "misty-org/misty")).toEqual([
    "project.edit",
    "project.install",
    "git.push",
  ]);
  expect(legacyActions(flags, null)).toEqual(["project.edit", "project.install"]);
  expect(legacyActions({ ...flags, allowInstalls: false, allowPush: false }, null)).toEqual([
    "project.edit",
  ]);
});

it("marks a project done once the server took it, and retries later otherwise", async () => {
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "project_legacy_flags"
      ? [
          [{ scopeId: "scope_a", allowInstalls: true, allowPush: false }, null],
          [{ scopeId: "scope_b", allowInstalls: false, allowPush: false }, null],
        ]
      : undefined,
  );
  mocks.apiRequest
    .mockResolvedValueOnce({ created: 2 })
    .mockRejectedValueOnce(new ApiRequestError("not attached", 409, "project_not_attached"));
  await migrateProjectSwitches();
  expect(mocks.invoke).toHaveBeenCalledWith("project_legacy_flags_done", { scopeId: "scope_a" });
  expect(mocks.invoke).not.toHaveBeenCalledWith("project_legacy_flags_done", {
    scopeId: "scope_b",
  });
});
