import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: async () => "http://127.0.0.1:8082",
}));

import { vaultNative } from "./native";

describe("vaultNative", () => {
  beforeEach(() => invoke.mockClear());

  // A Promise here reaches Tauri as `{}` and the command fails before it starts.
  it("sends the server's address itself, not a promise of it", async () => {
    await vaultNative.state();
    expect(invoke).toHaveBeenCalledWith("vault_state", { apiBase: "http://127.0.0.1:8082" });
  });

  it("keeps a command's own arguments beside the address", async () => {
    await vaultNative.renameSession("session", "Laptop");
    expect(invoke).toHaveBeenCalledWith("vault_rename_session", {
      apiBase: "http://127.0.0.1:8082",
      sessionId: "session",
      name: "Laptop",
    });
  });
});
