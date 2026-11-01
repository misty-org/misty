import { beforeEach, describe, expect, it } from "vitest";
import {
  accountClosingMessage,
  accountLimitMessage,
  noteAccountResponse,
  useAccountClosing,
  useAccountSuspension,
} from "./accountLimits";
import { decodeApiError } from "./errors";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("account limits", () => {
  beforeEach(() => {
    useAccountSuspension.setState({ suspended: false });
    useAccountClosing.setState({ deleteAt: null });
  });

  it("words each limit with what to do next", () => {
    expect(accountLimitMessage("device_limit_reached")).toContain("Settings › Devices");
    expect(accountLimitMessage("storage_limit_reached")).toContain("Free some space");
    expect(accountLimitMessage("owner_storage_quota_exceeded")).toBe(
      accountLimitMessage("storage_limit_reached"),
    );
    expect(accountLimitMessage("account_suspended")).toContain("support@mistysys.com");
    expect(accountLimitMessage("not_found")).toBeNull();
    expect(decodeApiError(JSON.stringify({ code: "device_limit_reached" })).message).toBe(
      accountLimitMessage("device_limit_reached"),
    );
  });

  it("notices a suspension on any answer and keeps the caller's body", async () => {
    const response = json(403, { code: "account_suspended", message: "server words" });
    noteAccountResponse("https://api.mistysys.com/v1/spaces", response);
    await settle();
    expect(useAccountSuspension.getState().suspended).toBe(true);
    await expect(response.json()).resolves.toMatchObject({ code: "account_suspended" });
  });

  it("ignores other refusals, and clears once the account is signed in again", async () => {
    noteAccountResponse("https://api.mistysys.com/v1/spaces", json(403, { code: "forbidden" }));
    await settle();
    expect(useAccountSuspension.getState().suspended).toBe(false);
    useAccountSuspension.setState({ suspended: true });
    noteAccountResponse("https://api.mistysys.com/v1/health", json(200, {}));
    expect(useAccountSuspension.getState().suspended).toBe(true);
    noteAccountResponse("https://api.mistysys.com/v1/me", json(200, {}));
    expect(useAccountSuspension.getState().suspended).toBe(false);
  });

  it("notices a closing account from /me and from a refused change, and clears when it resumes", async () => {
    noteAccountResponse(
      "https://api.mistysys.com/v1/me",
      json(200, { id: "u1", delete_at: "2026-12-01T15:00:00Z" }),
    );
    await settle();
    expect(useAccountClosing.getState().deleteAt).toBe("2026-12-01T15:00:00Z");
    expect(useAccountSuspension.getState().suspended).toBe(false);

    useAccountClosing.setState({ deleteAt: null });
    const refused = json(403, {
      code: "account_closing",
      message: "server words",
      delete_at: "2026-12-02T00:00:00Z",
    });
    noteAccountResponse("https://api.mistysys.com/v1/spaces", refused);
    await settle();
    expect(useAccountClosing.getState().deleteAt).toBe("2026-12-02T00:00:00Z");
    await expect(refused.json()).resolves.toMatchObject({ code: "account_closing" });

    // Other answers leave it; a /me without a date (resumed) clears it.
    noteAccountResponse("https://api.mistysys.com/v1/spaces", json(200, { delete_at: null }));
    await settle();
    expect(useAccountClosing.getState().deleteAt).toBe("2026-12-02T00:00:00Z");
    noteAccountResponse("https://api.mistysys.com/v1/me", json(200, { id: "u1", delete_at: null }));
    await settle();
    expect(useAccountClosing.getState().deleteAt).toBeNull();
  });

  it("words closing with the deletion date and how to keep the account", () => {
    const message = accountClosingMessage("2026-12-01T15:00:00Z");
    expect(message).toContain("read-only");
    expect(message).toContain("export");
    expect(message).toContain("2026");
    expect(message).toContain("Subscribe again");
    expect(accountClosingMessage(null)).toBe(accountLimitMessage("account_closing"));
    expect(decodeApiError(JSON.stringify({ code: "account_closing" })).message).toBe(
      accountLimitMessage("account_closing"),
    );
  });
});
