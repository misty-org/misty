import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSshEnvironments,
  preflightSshEnvironment,
  sshEnvironmentSummary,
  terminalEnvironmentRequest,
  trustSshHost,
  type SshEnvironment,
} from "./sshEnvironments";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const environment: SshEnvironment = {
  id: "production",
  label: "Production",
  host: "prod.example.com",
  user: "deploy",
  port: 2222,
  configPath: "/Users/local/.ssh/config",
  deviceLocal: true,
  agentTools: "device_local",
};

describe("SSH terminal environments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses native commands with structured arguments", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([environment]);
    await expect(listSshEnvironments()).resolves.toEqual([environment]);
    expect(invoke).toHaveBeenCalledWith("terminal_ssh_environments");

    vi.mocked(invoke).mockResolvedValueOnce({ state: "trusted", fingerprints: [], message: "ok" });
    await preflightSshEnvironment("production");
    expect(invoke).toHaveBeenLastCalledWith("terminal_ssh_preflight", {
      environmentId: "production",
    });

    vi.mocked(invoke).mockResolvedValueOnce({ state: "trusted", fingerprints: [], message: "ok" });
    await trustSshHost("production", "SHA256:abc");
    expect(invoke).toHaveBeenLastCalledWith("terminal_ssh_trust_host", {
      request: { environmentId: "production", fingerprint: "SHA256:abc" },
    });
  });

  it("sends only a config alias to terminal creation", () => {
    expect(terminalEnvironmentRequest({ kind: "ssh", ssh: environment })).toEqual({
      kind: "ssh",
      id: "production",
    });
    const serialized = JSON.stringify(
      terminalEnvironmentRequest({ kind: "ssh", ssh: environment }),
    );
    expect(serialized).not.toContain("configPath");
    expect(serialized).not.toContain("IdentityFile");
    expect(serialized).not.toContain("private");
  });

  it("formats safe connection metadata without credential fields", () => {
    expect(sshEnvironmentSummary(environment)).toBe("deploy@prod.example.com:2222");
  });
});
