import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  derive: vi.fn(),
  known: vi.fn(() => false),
  mark: vi.fn(),
  problem: vi.fn(async (): Promise<string | null> => null),
}));
vi.mock("@/api/account/api", () => ({
  accountApi: { changePassword: mocks.changePassword },
  isAccountUnauthorizedError: (error: unknown) => (error as { status?: number })?.status === 401,
}));
vi.mock("./accountCredential", () => ({
  deriveLoginCredential: mocks.derive,
  isCredentialEmail: mocks.known,
  markCredentialAccount: mocks.mark,
  passwordProblem: mocks.problem,
}));
import { accountChangePassword, accountSetFirstPassword } from "./accountPassword";
import { markPasswordPending, pendingPasswordEmail } from "./pendingPassword";
import { passwordResetToken, rememberPasswordReset } from "./passwordReset";

const unauthorized = Object.assign(new Error("invalid credentials"), { status: 401 });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.known.mockReturnValue(false);
  mocks.derive.mockImplementation(
    async (_email: string, password: string) => `credential:${password}`,
  );
});

describe("changing the account password", () => {
  it("sends only derived values for an account that already uses them", async () => {
    mocks.changePassword.mockResolvedValue({ status: "ok" });
    await accountChangePassword("ada@example.test", "old", "new");
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
    expect(mocks.changePassword).toHaveBeenCalledWith("credential:old", "credential:new");
  });

  it("falls back to the current password as typed for an account the server holds that way", async () => {
    mocks.changePassword
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce({ status: "ok" });
    await accountChangePassword("ada@example.test", "old", "new");
    expect(mocks.changePassword.mock.calls).toEqual([
      ["credential:old", "credential:new"],
      ["old", "credential:new"],
    ]);
  });

  it("never sends the current password in plain form for an account known to use credentials", async () => {
    mocks.known.mockReturnValue(true);
    mocks.changePassword.mockRejectedValue(unauthorized);
    await expect(accountChangePassword("ada@example.test", "wrong", "new")).rejects.toBe(
      unauthorized,
    );
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
    await expect(accountChangePassword("ada@example.test", "wrong", "new")).rejects.toBe(
      unauthorized,
    );
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

describe("the first password after a setup key", () => {
  beforeEach(() => {
    localStorage.clear();
    markPasswordPending("account-1", "ada@example.test");
  });

  it("sends a derived credential with an empty current password and marks the account", async () => {
    mocks.changePassword.mockResolvedValue({ status: "ok" });
    await expect(
      accountSetFirstPassword("account-1", "ada@example.test", "a long password"),
    ).resolves.toBe("set");
    expect(mocks.derive).toHaveBeenCalledWith("ada@example.test", "a long password");
    expect(mocks.changePassword).toHaveBeenCalledWith("", "credential:a long password", undefined);
    // The same email the keys came from is kept, so the vault key is rebuilt the same way.
    expect(mocks.mark).toHaveBeenCalledWith("account-1", "ada@example.test");
    expect(pendingPasswordEmail("account-1")).toBeNull();
  });

  it("checks the password rules before anything reaches the server", async () => {
    mocks.problem.mockResolvedValueOnce("Use at least 12 characters.");
    await expect(accountSetFirstPassword("account-1", "ada@example.test", "short")).rejects.toThrow(
      "Use at least 12 characters.",
    );
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(pendingPasswordEmail("account-1")).toBe("ada@example.test");
  });

  it("replaces a forgotten password with the sign-in's reset token", async () => {
    rememberPasswordReset("account-1", "reset-token");
    mocks.changePassword.mockResolvedValue({ status: "ok" });
    await expect(
      accountSetFirstPassword("account-1", "ada@example.test", "a long password"),
    ).resolves.toBe("set");
    expect(mocks.changePassword).toHaveBeenCalledWith(
      "",
      "credential:a long password",
      "reset-token",
    );
    expect(passwordResetToken("account-1")).toBeUndefined();
  });

  it("says so when the sign-in can no longer reset the password", async () => {
    rememberPasswordReset("account-1", "expired-token");
    mocks.changePassword.mockRejectedValue(unauthorized);
    await expect(
      accountSetFirstPassword("account-1", "ada@example.test", "a long password"),
    ).rejects.toThrow("can no longer set a password");
    expect(mocks.mark).not.toHaveBeenCalled();
  });

  it("keeps the password an account already has", async () => {
    mocks.changePassword.mockRejectedValue(unauthorized);
    await expect(
      accountSetFirstPassword("account-1", "ada@example.test", "a long password"),
    ).resolves.toBe("existing");
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(pendingPasswordEmail("account-1")).toBeNull();
  });

  it("stays pending when the server can't be reached", async () => {
    mocks.changePassword.mockRejectedValue(new Error("offline"));
    await expect(
      accountSetFirstPassword("account-1", "ada@example.test", "a long password"),
    ).rejects.toThrow("offline");
    expect(pendingPasswordEmail("account-1")).toBe("ada@example.test");
  });

  it("needs the desktop app to derive the credential", async () => {
    mocks.derive.mockResolvedValueOnce(null as unknown as string);
    await expect(
      accountSetFirstPassword("account-1", "ada@example.test", "a long password"),
    ).rejects.toThrow("desktop app");
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });
});
