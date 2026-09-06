import type { MistyTerminalSDK } from "@misty/sdk";

interface SshEnvironmentBase {
  id: string;
  label: string;
  host: string;
  user?: string;
  port: number;
  deviceLocal: true;
  agentTools: "device_local";
}

export interface ConfiguredSshEnvironment extends SshEnvironmentBase {
  source: "configured";
  configPath?: string;
}

export interface DirectSshEnvironment extends SshEnvironmentBase {
  source: "direct";
}

export type SshEnvironment = ConfiguredSshEnvironment | DirectSshEnvironment;

export type SshConnectionRequest =
  | { kind: "configured"; id: string }
  | { kind: "direct"; host: string; user?: string; port: number };

export type TerminalEnvironment = { kind: "local" } | { kind: "ssh"; ssh: SshEnvironment };

export interface SshHostKeyStatus {
  state: "trusted" | "confirmation_required" | "mismatch" | "unavailable";
  fingerprints: string[];
  message: string;
}

export type SshConnectionInputResult =
  { ok: true; environment: SshEnvironment } | { ok: false; message: string };

export const localTerminalEnvironment: TerminalEnvironment = { kind: "local" };

export async function listSshEnvironments(terminal: MistyTerminalSDK): Promise<SshEnvironment[]> {
  const environments = await terminal.environments();
  return environments.map(({ user, ...environment }) => ({
    ...environment,
    ...(user ? { user } : {}),
    source: "configured",
    deviceLocal: true,
    agentTools: "device_local",
  }));
}

export async function preflightSshEnvironment(
  terminal: MistyTerminalSDK,
  environment: SshEnvironment,
): Promise<SshHostKeyStatus> {
  return terminal.preflight(sshConnectionRequest(environment)) as Promise<SshHostKeyStatus>;
}

export async function trustSshHost(
  terminal: MistyTerminalSDK,
  environment: SshEnvironment,
  fingerprint: string,
): Promise<SshHostKeyStatus> {
  return terminal.trustHost(
    sshConnectionRequest(environment),
    fingerprint,
  ) as Promise<SshHostKeyStatus>;
}

export function terminalEnvironmentRequest(environment: TerminalEnvironment) {
  return environment.kind === "ssh"
    ? { kind: "ssh" as const, connection: sshConnectionRequest(environment.ssh) }
    : { kind: "local" as const };
}

export function sshConnectionRequest(environment: SshEnvironment): SshConnectionRequest {
  return environment.source === "configured"
    ? { kind: "configured", id: environment.id }
    : {
        kind: "direct",
        host: environment.host,
        ...(environment.user ? { user: environment.user } : {}),
        port: environment.port,
      };
}

export function sshEnvironmentSummary(environment: SshEnvironment): string {
  const destination = environment.user
    ? `${environment.user}@${environment.host}`
    : environment.host;
  return environment.port === 22 ? destination : `${destination}:${environment.port}`;
}

export function terminalEnvironmentIdentity(environment: TerminalEnvironment): string {
  if (environment.kind === "local") return "local";
  const ssh = environment.ssh;
  return ssh.source === "configured"
    ? `configured:${ssh.id}`
    : `direct:${ssh.user ?? ""}@${ssh.host}:${ssh.port}`;
}

export function resolveSshConnectionInput(
  input: string,
  configuredEnvironments: SshEnvironment[],
): SshConnectionInputResult {
  const raw = input.trim();
  if (!raw) return { ok: false, message: "Enter an SSH host to connect." };
  if (
    raw.length > 512 ||
    [...raw].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return { ok: false, message: "That SSH connection is not valid." };
  }

  const tokens = raw.split(/\s+/);
  if (tokens[0]?.toLowerCase() === "ssh") tokens.shift();
  if (tokens.length === 0) return { ok: false, message: "Enter an SSH host to connect." };

  let destination = "";
  let optionPort: number | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === "-p") {
      const next = tokens[index + 1] ?? "";
      const parsed = parsePort(next);
      if (!parsed) return { ok: false, message: "SSH ports must be between 1 and 65535." };
      optionPort = parsed;
      index += 1;
      continue;
    }
    if (/^-p\d+$/.test(token)) {
      const parsed = parsePort(token.slice(2));
      if (!parsed) return { ok: false, message: "SSH ports must be between 1 and 65535." };
      optionPort = parsed;
      continue;
    }
    if (token.startsWith("-")) {
      return {
        ok: false,
        message: "Use a host and optional -p port. Other SSH options are not supported here.",
      };
    }
    if (destination) {
      return { ok: false, message: "Enter one SSH destination at a time." };
    }
    destination = token;
  }

  if (!destination) return { ok: false, message: "Enter an SSH host to connect." };

  const configured = configuredEnvironments.find((environment) => {
    if (environment.source !== "configured") return false;
    const normalized = destination.toLowerCase();
    return [environment.id, environment.label, sshEnvironmentSummary(environment)].some(
      (value) => value.toLowerCase() === normalized,
    );
  });
  if (configured && optionPort === undefined) return { ok: true, environment: configured };

  const parsedDestination = parseDestination(destination);
  if (!parsedDestination.ok) return parsedDestination;
  const host = configured?.host ?? parsedDestination.host;
  const user = parsedDestination.user ?? configured?.user;
  const inlinePort = parsedDestination.port;
  if (inlinePort && optionPort && inlinePort !== optionPort) {
    return { ok: false, message: "The SSH port is specified twice with different values." };
  }
  const port = optionPort ?? inlinePort ?? configured?.port ?? 22;
  const environment: DirectSshEnvironment = {
    source: "direct",
    id: `direct:${user ?? ""}@${host}:${port}`,
    label: user ? `${user}@${host}` : host,
    host,
    ...(user ? { user } : {}),
    port,
    deviceLocal: true,
    agentTools: "device_local",
  };
  return { ok: true, environment };
}

function parseDestination(
  value: string,
): { ok: true; host: string; user?: string; port?: number } | { ok: false; message: string } {
  const at = value.lastIndexOf("@");
  const user = at >= 0 ? value.slice(0, at) : undefined;
  const hostWithPort = at >= 0 ? value.slice(at + 1) : value;
  if (at >= 0 && (!user || value.slice(0, at).includes("@") || !safeSshUser(user))) {
    return { ok: false, message: "Use a valid SSH user name before @." };
  }

  let host = hostWithPort;
  let port: number | undefined;
  if (hostWithPort.startsWith("[")) {
    const closingBracket = hostWithPort.indexOf("]");
    if (closingBracket < 0) return { ok: false, message: "Close the IPv6 address with ]." };
    host = hostWithPort.slice(1, closingBracket);
    const suffix = hostWithPort.slice(closingBracket + 1);
    if (suffix) {
      if (!suffix.startsWith(":")) return { ok: false, message: "That SSH host is not valid." };
      port = parsePort(suffix.slice(1));
      if (!port) return { ok: false, message: "SSH ports must be between 1 and 65535." };
    }
  } else if ((hostWithPort.match(/:/g) ?? []).length === 1) {
    const separator = hostWithPort.lastIndexOf(":");
    const candidatePort = hostWithPort.slice(separator + 1);
    if (/^\d+$/.test(candidatePort)) {
      host = hostWithPort.slice(0, separator);
      port = parsePort(candidatePort);
      if (!port) return { ok: false, message: "SSH ports must be between 1 and 65535." };
    }
  }

  if (!safeSshHost(host)) return { ok: false, message: "Use a valid host name or IP address." };
  return { ok: true, host, ...(user ? { user } : {}), ...(port ? { port } : {}) };
}

function parsePort(value: string): number | undefined {
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

function safeSshHost(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith("-") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function safeSshUser(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    !value.startsWith("-") &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}
