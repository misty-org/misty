import { beforeEach, describe, expect, it, vi } from "vitest";

const { appConfigureServer } = vi.hoisted(() => ({
  appConfigureServer: vi.fn(async () => undefined),
}));

vi.mock("@/native", () => ({
  appConfigureServer,
  appSnapshot: vi.fn(async () => ({
    environment: { serverMode: "hosted", serverUrl: null },
  })),
}));

import {
  inspectSelfHostedServer,
  readDeploymentScope,
  resolveHostedApiBase,
  saveDeploymentConfiguration,
  validateSelfHostedServerUrl,
} from "@/api/deployment/api";
import { mintSelfHostEntitlement } from "@/api/self-host/entitlement";

const descriptor = {
  server_id: "server_00000000-0000-0000-0000-000000000001",
  name: "Studio",
  deployment: "self_hosted" as const,
  protocol_version: 1,
  min_client_protocol: 1,
  max_client_protocol: 1,
  capabilities: {
    collaboration: true,
    library: true,
    notes: true,
    drawings: true,
    hosted_billing: false,
    hosted_integrations: false,
    hosted_ai: false,
    storage_backend: "filesystem",
  },
  bootstrap_required: true,
  registration: "invitation" as const,
};

describe("self-hosted deployment routing", () => {
  beforeEach(() => {
    localStorage.clear();
    appConfigureServer.mockClear();
    vi.restoreAllMocks();
  });

  it("uses the loopback Go API for ordinary desktop development", () => {
    expect(resolveHostedApiBase()).toBe("http://127.0.0.1:8081/v1");
  });

  it("requires HTTPS except for loopback development", () => {
    expect(validateSelfHostedServerUrl("https://misty.example.com/api/")).toBe(
      "https://misty.example.com/api",
    );
    expect(validateSelfHostedServerUrl("http://127.0.0.1:8080/api")).toBe(
      "http://127.0.0.1:8080/api",
    );
    expect(() => validateSelfHostedServerUrl("http://misty.lan/api")).toThrow("must use HTTPS");
  });

  it("validates a custom endpoint without sending credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(descriptor), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(inspectSelfHostedServer("https://misty.example.com")).resolves.toEqual(descriptor);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("rejects incompatible protocol versions before saving configuration", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...descriptor, min_client_protocol: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(inspectSelfHostedServer("https://misty.example.com")).rejects.toThrow(
      "not compatible",
    );
    expect(appConfigureServer).not.toHaveBeenCalled();
  });

  it("commits a deployment-specific namespace only after native configuration succeeds", async () => {
    await saveDeploymentConfiguration("self_hosted", "https://misty.example.com", descriptor);
    expect(appConfigureServer).toHaveBeenCalledWith(
      "self_hosted",
      "https://misty.example.com",
      descriptor.server_id,
      descriptor.name,
    );
    expect(readDeploymentScope()).toMatch(/^self-hosted-/);
  });

  it("mints through Hosted without disclosing the custom endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ token: "signed-proof", expires_at: "2026-08-20T00:00:00Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    await expect(mintSelfHostEntitlement("hosted-session")).resolves.toEqual({
      token: "signed-proof",
      expires_at: "2026-08-20T00:00:00Z",
    });
    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain("/billing/self-host-entitlement");
    expect(init?.body).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain("misty.example.com");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer hosted-session");
  });
});
