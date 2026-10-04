import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/native/invoke", () => native);
import { mutateState, readState } from "./persistence";

beforeEach(() => {
  native.invoke.mockReset();
});

it("uses native account-scoped storage and surfaces a missing host", async () => {
  native.invoke.mockRejectedValue(new Error("Native host unavailable"));
  await expect(readState("account-a")).rejects.toThrow("Native host unavailable");
  expect(native.invoke).toHaveBeenCalledWith("settings_profile_state", { scope: "account-a" });
});

it("retries a native revision conflict against the new state without losing another window's edits", async () => {
  native.invoke
    .mockResolvedValueOnce({ revision: 1, state: { first: 1 } })
    .mockRejectedValueOnce(new Error("SETTINGS_REVISION_CONFLICT"))
    .mockResolvedValueOnce({ revision: 2, state: { first: 1, other: 2 } })
    .mockResolvedValueOnce(undefined);
  expect(
    await mutateState(
      "account-a",
      () => ({}),
      (value) => ({ ...value, mine: 3 }),
    ),
  ).toEqual({ first: 1, other: 2, mine: 3 });
  expect(native.invoke).toHaveBeenLastCalledWith("settings_profile_commit", {
    scope: "account-a",
    revision: 2,
    document: { first: 1, other: 2, mine: 3 },
  });
});
