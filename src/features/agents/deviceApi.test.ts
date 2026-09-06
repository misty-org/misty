import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceSignaturePayload, signedAgentDeviceRequest } from "./store/useAgentDeviceStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("device request signing", () => {
  it("uses the server-visible API pathname and exact canonical line order", () => {
    expect(
      deviceSignaturePayload(
        "post",
        "/devices/device_123/workflow-node-jobs/claim?ignored=true",
        "1900000000",
        "bm9uY2U=",
        "E3B0C442",
      ),
    ).toBe(
      "POST\n/api/devices/device_123/workflow-node-jobs/claim\n1900000000\nbm9uY2U=\ne3b0c442",
    );
  });

  it("uses the configured versioned API base when signing hosted requests", () => {
    expect(
      deviceSignaturePayload(
        "post",
        "/devices/device_123/presence",
        "1900000000",
        "bm9uY2U=",
        "E3B0C442",
        "/v1",
      ),
    ).toBe("POST\n/v1/devices/device_123/presence\n1900000000\nbm9uY2U=\ne3b0c442");
  });

  it("does not reopen a denied device-identity Keychain request during the same session", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Keychain access denied"));
    const deviceId = "device_keychain_denied_for_this_session";

    await expect(
      signedAgentDeviceRequest(deviceId, "/devices/test/heartbeat", { method: "POST" }),
    ).rejects.toThrow("Keychain access denied");
    await expect(
      signedAgentDeviceRequest(deviceId, "/devices/test/heartbeat", { method: "POST" }),
    ).rejects.toThrow("Keychain access denied");

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
