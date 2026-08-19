import { spaceRequest } from "@/api/spaces/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { githubCodeApi } from "./github";

vi.mock("@/api/spaces/api", () => ({ spaceRequest: vi.fn() }));

describe("githubCodeApi", () => {
  beforeEach(() => vi.mocked(spaceRequest).mockReset());

  it("uses the frozen GitHub App and repository routes", async () => {
    vi.mocked(spaceRequest).mockResolvedValue({});
    await githubCodeApi.beginInstall("space one", "/code");
    await githubCodeApi.createHandoff("space one", "workspace/one");

    expect(spaceRequest).toHaveBeenNthCalledWith(
      1,
      "/spaces/space%20one/integrations/github/install",
      { method: "POST", body: JSON.stringify({ return_to: "/code" }) },
    );
    expect(spaceRequest).toHaveBeenNthCalledWith(
      2,
      "/spaces/space%20one/code/github/workspaces/workspace%2Fone/credential-handoff",
      { method: "POST" },
    );
  });

  it("always includes explicit confirmation in remote mutations", async () => {
    vi.mocked(spaceRequest).mockResolvedValue({});
    await githubCodeApi.mutate("space-1", "workspace-1", {
      operation: "create_pull_request",
      confirmed: true,
      payload: { title: "Ship it", head: "feature", base: "main" },
    });

    expect(spaceRequest).toHaveBeenCalledWith(
      "/spaces/space-1/code/github/workspaces/workspace-1/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operation: "create_pull_request",
          confirmed: true,
          payload: { title: "Ship it", head: "feature", base: "main" },
        }),
      }),
    );
  });
});
