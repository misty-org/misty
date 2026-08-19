import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { codeGitClone, codeGitFetch, codeGitPush } from "./native";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("native GitHub bridge", () => {
  beforeEach(() => vi.mocked(invoke).mockReset().mockResolvedValue(""));

  it("passes only the one-time handoff and redeem endpoint to native", async () => {
    await codeGitClone(
      "/projects/demo",
      "https://misty.test/native/github/credential-handoffs/redeem",
      "opaque-once",
    );
    await codeGitFetch(
      "/projects/demo",
      "https://misty.test/native/github/credential-handoffs/redeem",
      "opaque-twice",
    );
    await codeGitPush(
      "/projects/demo",
      "https://misty.test/native/github/credential-handoffs/redeem",
      "opaque-thrice",
    );

    expect(invoke).toHaveBeenNthCalledWith(1, "code_git_clone", {
      request: {
        destination: "/projects/demo",
        redeemUrl: "https://misty.test/native/github/credential-handoffs/redeem",
        handoff: "opaque-once",
      },
    });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain("access_token");
  });
});
