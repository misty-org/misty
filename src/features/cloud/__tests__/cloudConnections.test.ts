import { spaceRequest } from "@/services/spaces/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginCloudAuthorization,
  cloudConnectionsSnapshot,
  cloudConnectionToken,
  deleteCloudConnection,
} from "../cloudConnections";

vi.mock("@/services/spaces/api", () => ({
  spaceRequest: vi.fn(),
}));

describe("cloud connection API", () => {
  beforeEach(() => {
    vi.mocked(spaceRequest).mockReset();
  });

  it("starts provider OAuth with optional custom client credentials", async () => {
    vi.mocked(spaceRequest).mockResolvedValue({
      authorization_url: "https://provider.example/authorize",
      state_expires_at: "2026-07-28T01:00:00Z",
    });

    await beginCloudAuthorization({
      provider: "drive",
      name: "Work",
      clientId: " custom-id ",
      clientSecret: " custom-secret ",
    });

    expect(spaceRequest).toHaveBeenCalledWith("/cloud/connections/drive/authorize", {
      method: "POST",
      body: JSON.stringify({
        name: "Work",
        clientID: "custom-id",
        clientSecret: "custom-secret",
        returnTo: "/files",
      }),
    });
  });

  it("uses metadata and token-lease endpoints without file payload routes", async () => {
    vi.mocked(spaceRequest).mockResolvedValue(undefined);

    await cloudConnectionsSnapshot();
    await cloudConnectionToken("cloud 123");
    await deleteCloudConnection("cloud 123");

    expect(spaceRequest).toHaveBeenNthCalledWith(1, "/cloud/connections");
    expect(spaceRequest).toHaveBeenNthCalledWith(2, "/cloud/connections/cloud%20123/token", {
      method: "POST",
    });
    expect(spaceRequest).toHaveBeenNthCalledWith(3, "/cloud/connections/cloud%20123", {
      method: "DELETE",
    });
  });
});
