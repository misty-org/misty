import type { MistyTerminalSDK } from "@misty/sdk";
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

const terminal = {
  environments: vi.fn(),
  preflight: vi.fn(),
  trustHost: vi.fn(),
} as unknown as MistyTerminalSDK;

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

  it("uses SDK methods with structured arguments", async () => {
    const { source: _source, ...listedEnvironment } = environment;
    vi.mocked(terminal.environments).mockResolvedValueOnce([listedEnvironment]);
    await expect(listSshEnvironments(terminal)).resolves.toEqual([environment]);
    expect(terminal.environments).toHaveBeenCalledWith();

    vi.mocked(terminal.preflight).mockResolvedValueOnce({
      state: "trusted",
      fingerprints: [],
      message: "ok",
    });
    await preflightSshEnvironment(terminal, environment);
    expect(terminal.preflight).toHaveBeenLastCalledWith({ kind: "configured", id: "production" });

    vi.mocked(terminal.trustHost).mockResolvedValueOnce({
      state: "trusted",
      fingerprints: [],
      message: "ok",
    });
    await trustSshHost(terminal, environment, "SHA256:abc");
    expect(terminal.trustHost).toHaveBeenLastCalledWith(
      { kind: "configured", id: "production" },
      "SHA256:abc",
    );
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
