import { apiRequest } from "@/api/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginCloudAuthorization,
  bindCloudConnection,
  cloudConnectionHandoff,
  cloudConnectionsSnapshot,
  deleteCloudConnection,
} from "./api";

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
}));

describe("cloud connection API", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  it("starts provider OAuth with optional custom client credentials", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      authorization_url: "https://provider.example/authorize",
      state_expires_at: "2026-07-28T01:00:00Z",
    });

    await beginCloudAuthorization({
      provider: "drive",
      name: "Work",
      clientId: " custom-id ",
      clientSecret: " custom-secret ",
    });

    expect(apiRequest).toHaveBeenCalledWith("/cloud/connections/drive/authorize", {
      method: "POST",
      body: JSON.stringify({
        name: "Work",
        clientID: "custom-id",
        clientSecret: "custom-secret",
        returnTo: "/files",
      }),
    });
  });

  it("uses metadata and one-time handoff endpoints without exposing provider tokens", async () => {
    vi.mocked(apiRequest).mockResolvedValue(undefined);

    await cloudConnectionsSnapshot();
    await cloudConnectionHandoff("cloud 123");
    await bindCloudConnection({ connectionId: "connection 123", name: "Work" });
    await deleteCloudConnection("cloud 123");

    expect(apiRequest).toHaveBeenNthCalledWith(1, "/cloud/connections");
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/cloud/connections/cloud%20123/handoff", {
      method: "POST",
    });
    expect(apiRequest).toHaveBeenNthCalledWith(3, "/cloud/connections/bind", {
      method: "POST",
      body: JSON.stringify({ connection_id: "connection 123", name: "Work" }),
    });
    expect(apiRequest).toHaveBeenNthCalledWith(4, "/cloud/connections/cloud%20123", {
      method: "DELETE",
    });
  });
});
