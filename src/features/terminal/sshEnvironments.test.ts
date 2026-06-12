import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSshEnvironments,
  preflightSshEnvironment,
  resolveSshConnectionInput,
  sshEnvironmentSummary,
  terminalEnvironmentRequest,
  trustSshHost,
  type SshEnvironment,
} from "./sshEnvironments";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const environment: SshEnvironment = {
  source: "configured",
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
    const { source: _source, ...listedEnvironment } = environment;
    vi.mocked(invoke).mockResolvedValueOnce([listedEnvironment]);
    await expect(listSshEnvironments()).resolves.toEqual([environment]);
    expect(invoke).toHaveBeenCalledWith("terminal_ssh_environments");

    vi.mocked(invoke).mockResolvedValueOnce({ state: "trusted", fingerprints: [], message: "ok" });
    await preflightSshEnvironment(environment);
    expect(invoke).toHaveBeenLastCalledWith("terminal_ssh_preflight", {
      connection: { kind: "configured", id: "production" },
    });

    vi.mocked(invoke).mockResolvedValueOnce({ state: "trusted", fingerprints: [], message: "ok" });
    await trustSshHost(environment, "SHA256:abc");
    expect(invoke).toHaveBeenLastCalledWith("terminal_ssh_trust_host", {
      request: {
        connection: { kind: "configured", id: "production" },
        fingerprint: "SHA256:abc",
      },
    });
  });

  it("sends only a config alias to terminal creation", () => {
    expect(terminalEnvironmentRequest({ kind: "ssh", ssh: environment })).toEqual({
      kind: "ssh",
      connection: { kind: "configured", id: "production" },
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

  it("parses a direct OpenSSH destination into structured connection metadata", () => {
    const result = resolveSshConnectionInput("ssh deploy@example.com -p 2200", [environment]);
    expect(result).toEqual({
      ok: true,
      environment: {
        source: "direct",
        id: "direct:deploy@example.com:2200",
        label: "deploy@example.com",
        host: "example.com",
        user: "deploy",
        port: 2200,
        deviceLocal: true,
        agentTools: "device_local",
      },
    });
    if (!result.ok) throw new Error(result.message);
    expect(terminalEnvironmentRequest({ kind: "ssh", ssh: result.environment })).toEqual({
      kind: "ssh",
      connection: {
        kind: "direct",
        host: "example.com",
        user: "deploy",
        port: 2200,
      },
    });
  });

  it("resolves saved aliases and rejects unsupported SSH options", () => {
    expect(resolveSshConnectionInput("production", [environment])).toEqual({
      ok: true,
      environment,
    });
    expect(resolveSshConnectionInput("ssh example.com -o ProxyCommand=bad", [environment])).toEqual(
      {
        ok: false,
        message: "Use a host and optional -p port. Other SSH options are not supported here.",
      },
    );
  });
});
