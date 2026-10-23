import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  derive: vi.fn(),
  known: vi.fn(() => false),
}));
vi.mock("@/api/account/api", () => ({
  accountApi: { changePassword: mocks.changePassword },
  isAccountUnauthorizedError: (error: unknown) => (error as { status?: number })?.status === 401,
}));
vi.mock("./accountCredential", () => ({
  deriveLoginCredential: mocks.derive,
  isCredentialEmail: mocks.known,
}));
import { accountChangePassword } from "./accountPassword";

const unauthorized = Object.assign(new Error("invalid credentials"), { status: 401 });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.known.mockReturnValue(false);
  mocks.derive.mockImplementation(async (_email: string, password: string) => `credential:${password}`);
});

describe("changing the account password", () => {
  it("sends only derived values for an account that already uses them", async () => {
    mocks.changePassword.mockResolvedValue({ status: "ok" });
    await accountChangePassword("ada@example.test", "old", "new");
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
    expect(mocks.changePassword).toHaveBeenCalledWith("credential:old", "credential:new");
  });

  it("falls back to the current password as typed for an account the server holds that way", async () => {
    mocks.changePassword.mockRejectedValueOnce(unauthorized).mockResolvedValueOnce({ status: "ok" });
    await accountChangePassword("ada@example.test", "old", "new");
    expect(mocks.changePassword.mock.calls).toEqual([
      ["credential:old", "credential:new"],
      ["old", "credential:new"],
    ]);
  });

  it("never sends the current password in plain form for an account known to use credentials", async () => {
    mocks.known.mockReturnValue(true);
    mocks.changePassword.mockRejectedValue(unauthorized);
    await expect(accountChangePassword("ada@example.test", "wrong", "new")).rejects.toBe(unauthorized);
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
    expect(mocks.changePassword).toHaveBeenCalledWith("credential:wrong", "credential:new");
  });

  it("refuses to make the current password the new one", async () => {
    await expect(accountChangePassword("ada@example.test", "same", "same")).rejects.toThrow(
      "not used before",
    );
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("reports a wrong current password after both attempts", async () => {
    mocks.changePassword.mockRejectedValue(unauthorized);
    await expect(accountChangePassword("ada@example.test", "wrong", "new")).rejects.toBe(unauthorized);
    expect(mocks.changePassword).toHaveBeenCalledTimes(2);
  });

  it("does not retry a server failure", async () => {
    mocks.changePassword.mockRejectedValue(Object.assign(new Error("down"), { status: 500 }));
    await expect(accountChangePassword("ada@example.test", "old", "new")).rejects.toThrow("down");
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
  });

  it("is not available outside the desktop app, where nothing can be derived", async () => {
    mocks.derive.mockResolvedValue(null);
    await expect(accountChangePassword("ada@example.test", "old", "new")).rejects.toThrow(
      "desktop app",
    );
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });
});
