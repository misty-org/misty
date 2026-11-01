import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/api/client/errors";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  deriveLoginCredential: vi.fn(),
  isCredentialEmail: vi.fn(),
}));

vi.mock("@/api/client/request", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("./store/accountCredential", () => ({
  deriveLoginCredential: mocks.deriveLoginCredential,
  isCredentialEmail: mocks.isCredentialEmail,
}));

import { accountExportError, requestAccountExport } from "./accountExport";

const refused = () => new ApiRequestError("refused", 401, "account_reauthentication_failed", "{}");
const sent = (call: number) => JSON.parse(mocks.apiRequest.mock.calls[call]![1].body as string);

describe("account export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiRequest.mockResolvedValue({ account_data: {} });
    mocks.deriveLoginCredential.mockResolvedValue("derived");
    mocks.isCredentialEmail.mockReturnValue(false);
  });

  it("sends the credential derived on this device", async () => {
    await expect(requestAccountExport("me@example.com", { password: "typed" })).resolves.toEqual({
      account_data: {},
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/me/export",
      expect.objectContaining({ method: "POST" }),
    );
    expect(sent(0)).toEqual({ password: "derived" });
  });

  it("falls back to the password as typed only for an account not known to use a credential", async () => {
    mocks.apiRequest.mockRejectedValueOnce(refused());
    await requestAccountExport("old@example.com", { password: "typed" });
    expect(sent(1)).toEqual({ password: "typed" });

    vi.clearAllMocks();
    mocks.deriveLoginCredential.mockResolvedValue("derived");
    mocks.isCredentialEmail.mockReturnValue(true);
    mocks.apiRequest.mockRejectedValueOnce(refused());
    await expect(requestAccountExport("me@example.com", { password: "typo" })).rejects.toThrow();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
  });

  it("sends a Google account's fresh sign-in instead of a password", async () => {
    await requestAccountExport("g@example.com", { reauthenticationToken: "token" });
    expect(sent(0)).toEqual({ reauthentication_token: "token" });
    expect(mocks.deriveLoginCredential).not.toHaveBeenCalled();
  });

  it("says plainly why an export failed", () => {
    expect(accountExportError(refused())).toContain("password");
    expect(accountExportError(new Error("network"))).toContain("Try again");
  });
});
