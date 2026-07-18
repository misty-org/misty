import type { FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

const mocks = vi.hoisted(() => ({ setup: vi.fn(), unlock: vi.fn() }));
vi.mock("../LibraryRuntime", () => ({ libraryApi: { reauthenticateLibrary: mocks.unlock } }));
vi.mock("@/api/account/api", () => ({
  accountApi: { setLibraryPassword: mocks.setup },
  AccountApiError: class extends Error {
    constructor(
      message: string,
      public status?: number,
    ) {
      super(message);
    }
  },
}));
import { useLibraryUnlock } from "./useLibraryUnlock";
import { AccountApiError } from "@/api/account/api";

function fixture(configured: boolean | null) {
  return {
    spaceId: "space",
    unlockScope: "hidden",
    unlockPassword: "library-password",
    unlockConfirmation: "library-password",
    unlockConfigured: configured,
    unlockSaving: false,
    setUnlockScope: vi.fn(),
    setUnlockPassword: vi.fn(),
    setUnlockConfirmation: vi.fn(),
    setUnlockConfigured: vi.fn(),
    setUnlockSaving: vi.fn(),
    setLocalError: vi.fn(),
    setSensitiveGrants: vi.fn(),
  };
}
const event = { preventDefault: vi.fn() } as unknown as FormEvent;

describe("separate library password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setup.mockReset().mockResolvedValue({ configured: true });
    mocks.unlock.mockReset().mockResolvedValue({ token: "grant", expires_at: "expiry" });
  });
  it("sets and confirms the first library password before unlocking", async () => {
    const data = fixture(false);
    await useLibraryUnlock(data as unknown as SpaceLibraryData).submitSensitiveUnlock(event);
    expect(mocks.setup).toHaveBeenCalledWith("library-password", "library-password");
    expect(mocks.unlock).toHaveBeenCalledWith("space", "hidden", "library-password");
    expect(mocks.setup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.unlock.mock.invocationCallOrder[0],
    );
    expect(data.setUnlockScope).toHaveBeenCalledWith("");
  });
  it("uses only the existing library password on later unlocks", async () => {
    const data = fixture(true);
    await useLibraryUnlock(data as unknown as SpaceLibraryData).submitSensitiveUnlock(event);
    expect(mocks.setup).not.toHaveBeenCalled();
    expect(mocks.unlock).toHaveBeenCalledWith("space", "hidden", "library-password");
  });
  it("requires matching confirmation before first use", async () => {
    const data = fixture(false);
    data.unlockConfirmation = "different";
    await useLibraryUnlock(data as unknown as SpaceLibraryData).submitSensitiveUnlock(event);
    expect(mocks.setup).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(data.setLocalError).toHaveBeenCalledWith("Library passwords do not match.");
  });
  it("does not unlock before checking whether a password exists", async () => {
    await useLibraryUnlock(fixture(null) as unknown as SpaceLibraryData).submitSensitiveUnlock(
      event,
    );
    expect(mocks.setup).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
  });
  it("returns to unlock when another device has already completed setup", async () => {
    mocks.setup.mockRejectedValue(new AccountApiError("Already set", 409));
    const data = fixture(false);
    await useLibraryUnlock(data as unknown as SpaceLibraryData).submitSensitiveUnlock(event);
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(data.setUnlockConfigured).toHaveBeenCalledWith(true);
    expect(data.setUnlockPassword).toHaveBeenCalledWith("");
  });
});
