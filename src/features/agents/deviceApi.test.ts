import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceSignaturePayload, signedAgentDeviceRequest } from "./store/useAgentDeviceStore";

const mocks = vi.hoisted(() => ({ request: vi.fn(), signRequest: vi.fn() }));
vi.mock("@/api/devices/api", () => ({ devicesApi: { request: mocks.request } }));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "https://misty.test/api" }));
vi.mock("@/features/auth/core", () => ({
  useUserStore: { getState: () => ({ me: { id: "user_1" } }) },
}));
vi.mock("@/native/devices", () => ({ devicesNative: { signRequest: mocks.signRequest } }));

beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue({ ok: true });
  mocks.signRequest.mockReset().mockResolvedValue("c2lnbmF0dXJl");
});

describe("device request signing", () => {
  it("signs natively over the server path, never with a key held here", async () => {
    await signedAgentDeviceRequest("local", "/devices/device_1/heartbeat?x=1", {
      method: "post",
      body: "{}",
    });
    const [account, request] = mocks.signRequest.mock.calls[0];
    expect(account).toEqual({ apiBase: "https://misty.test/api", accountId: "user_1" });
    expect(request).toMatchObject({ method: "POST", path: "/api/devices/device_1/heartbeat" });
    expect(request.bodyDigest).toBe(
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
    const [, init] = mocks.request.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("X-Misty-Device-Signature")).toBe("c2lnbmF0dXJl");
    expect(headers.get("X-Misty-Device-Timestamp")).toBe(request.timestamp);
    expect(headers.get("X-Misty-Device-Nonce")).toBe(request.nonce);
  });

  it("stops before sending when the scope closed while signing", async () => {
    let current = true;
    mocks.signRequest.mockImplementation(async () => {
      current = false;
      return "c2lnbmF0dXJl";
    });
    await expect(
      signedAgentDeviceRequest("local", "/devices/device_1/heartbeat", { method: "POST" }, () => {
        if (!current) throw new Error("Scope closed");
      }),
    ).rejects.toThrow("Scope closed");
    expect(mocks.request).not.toHaveBeenCalled();
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
});
