import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceSignaturePayload,
  signedAgentDeviceRequest,
  ensureServerAgentDevice,
} from "./store/useAgentDeviceStore";

const requests = vi.hoisted(() => ({ register: vi.fn(), request: vi.fn() }));
vi.mock("@/api/devices/api", () => ({ devicesApi: requests }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("device request signing", () => {
  it("rejects late identity loads before registering or dispatching after scope changes", async () => {
    for (const operation of ["register", "sign"]) {
      let finish!: (value: string) => void;
      vi.mocked(invoke).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve as (value: string) => void;
          }),
      );
      let current = true;
      const assertCurrent = () => {
        if (!current) throw new Error("Scope closed");
      };
      const deviceId = `device_late_scope_${operation}`;
      const pending =
        operation === "register"
          ? ensureServerAgentDevice({ id: deviceId } as never, {
              endpointId: "personal",
              platform: "macos",
              scope: { assertCurrent, signal: new AbortController().signal },
            })
          : signedAgentDeviceRequest(
              deviceId,
              "/devices/test/heartbeat",
              { method: "POST" },
              assertCurrent,
            );
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      current = false;
      finish(JSON.stringify({ publicKey: "public", privateKey: "private" }));
      await expect(pending).rejects.toThrow("Scope closed");
    }
    expect(requests.register).not.toHaveBeenCalled();
    expect(requests.request).not.toHaveBeenCalled();
  });

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
    ).toBe(
      "POST\n/v1/devices/device_123/presence\n1900000000\nbm9uY2U=\ne3b0c442",
    );
  });

  it("does not reopen a denied device-identity Keychain request during the same session", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Keychain access denied"));
    const deviceId = "device_keychain_denied_for_this_session";

    await expect(
      signedAgentDeviceRequest(deviceId, "/devices/test/heartbeat", {
        method: "POST",
      }),
    ).rejects.toThrow("Keychain access denied");
    await expect(
      signedAgentDeviceRequest(deviceId, "/devices/test/heartbeat", {
        method: "POST",
      }),
    ).rejects.toThrow("Keychain access denied");

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
