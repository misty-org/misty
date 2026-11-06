import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock("@/api/account/api", () => ({
  accountApi: { changePassword: mocks.changePassword },
  isAccountUnauthorizedError: (error: unknown) => (error as { status?: number })?.status === 401,
}));
import { accountChangePassword, accountSetFirstPassword } from "./accountPassword";
import { passwordResetToken, rememberPasswordReset } from "./passwordReset";
import { passwordProblem } from "./passwordRules";

const unauthorized = Object.assign(new Error("invalid credentials"), { status: 401 });
const next = "a-long-password";

beforeEach(() => {
  vi.clearAllMocks();
  rememberPasswordReset("account-1", undefined);
});

describe("the password rules", () => {
  it("are only length, a lowercase letter and a special character", () => {
    expect(passwordProblem("short-1")).toMatch(/8 characters/);
    expect(passwordProblem("ALL-CAPS-PASSWORD")).toMatch(/lowercase/);
    expect(passwordProblem("nospecialcharacter")).toMatch(/special/);
    expect(passwordProblem(`${"a-".repeat(37)}`)).toMatch(/72 bytes/);
    expect(passwordProblem("lower-only")).toBeNull();
    expect(passwordProblem("correct horse battery")).toBeNull();
  });
});

describe("changing the account password", () => {
  it("sends both passwords as typed", async () => {
    mocks.changePassword.mockResolvedValue({ status: "ok" });
    await accountChangePassword("old-password", next);
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
    expect(mocks.changePassword).toHaveBeenCalledWith("old-password", next);
  });

  it("refuses to make the current password the new one", async () => {
    await expect(accountChangePassword(next, next)).rejects.toThrow("not used before");
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("checks the rules before anything reaches the server", async () => {
    await expect(accountChangePassword("old-password", "short")).rejects.toThrow("8 characters");
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("reports a wrong current password once, without trying again", async () => {
    mocks.changePassword.mockRejectedValue(unauthorized);
    await expect(accountChangePassword("wrong-password", next)).rejects.toBe(unauthorized);
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
  });
});

describe("the password after a setup key", () => {
  it("sends the password with an empty current password", async () => {
    mocks.changePassword.mockResolvedValue({ status: "ok" });
    await expect(accountSetFirstPassword("account-1", next)).resolves.toBe("set");
    expect(mocks.changePassword).toHaveBeenCalledWith("", next, undefined);
  });

  it("checks the rules before anything reaches the server", async () => {
    await expect(accountSetFirstPassword("account-1", "short")).rejects.toThrow(
      "Use at least 8 characters.",
    );
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("replaces a forgotten password with the sign-in's reset token", async () => {
    rememberPasswordReset("account-1", "reset-token");
    mocks.changePassword.mockResolvedValue({ status: "ok" });
    await expect(accountSetFirstPassword("account-1", next)).resolves.toBe("set");
    expect(mocks.changePassword).toHaveBeenCalledWith("", next, "reset-token");
    expect(passwordResetToken("account-1")).toBeUndefined();
  });

  it("says so when the sign-in can no longer reset the password", async () => {
    rememberPasswordReset("account-1", "expired-token");
    mocks.changePassword.mockRejectedValue(unauthorized);
    await expect(accountSetFirstPassword("account-1", next)).rejects.toThrow(
      "can no longer set a password",
    );
  });

  it("keeps the password an account already has", async () => {
    mocks.changePassword.mockRejectedValue(unauthorized);
    await expect(accountSetFirstPassword("account-1", next)).resolves.toBe("existing");
  });

  it("passes on a failure to reach the server", async () => {
    mocks.changePassword.mockRejectedValue(new Error("offline"));
    await expect(accountSetFirstPassword("account-1", next)).rejects.toThrow("offline");
  });
});
