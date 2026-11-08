import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/api/client/errors";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/api/client/request", () => ({ apiRequest: mocks.apiRequest }));

import { accountExportError, requestAccountExport } from "./accountExport";

const refused = () => new ApiRequestError("refused", 401, "account_reauthentication_failed", "{}");
const sent = (call: number) => JSON.parse(mocks.apiRequest.mock.calls[call]![1].body as string);

describe("account export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiRequest.mockResolvedValue({ account_data: {} });
  });

  it("sends the password as typed", async () => {
    await expect(requestAccountExport({ password: "typed" })).resolves.toEqual({
      account_data: {},
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/me/export",
      expect.objectContaining({ method: "POST" }),
    );
    expect(sent(0)).toEqual({ password: "typed" });
  });

  it("tries a refused password only once", async () => {
    mocks.apiRequest.mockRejectedValueOnce(refused());
    await expect(requestAccountExport({ password: "typo" })).rejects.toThrow();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
  });

  it("sends a Google account's fresh sign-in instead of a password", async () => {
    await requestAccountExport({ reauthenticationToken: "token" });
    expect(sent(0)).toEqual({ reauthentication_token: "token" });
  });

  it("says plainly why an export failed", () => {
    expect(accountExportError(refused())).toContain("password");
    expect(accountExportError(new Error("network"))).toContain("Try again");
  });
});
