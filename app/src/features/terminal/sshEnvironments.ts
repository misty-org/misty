import { invoke } from "@tauri-apps/api/core";

export interface SshEnvironment {
  id: string;
  label: string;
  host: string;
  user?: string;
  port: number;
  configPath: string;
  deviceLocal: true;
  agentTools: "device_local";
}

export type TerminalEnvironment = { kind: "local" } | { kind: "ssh"; ssh: SshEnvironment };

export interface SshHostKeyStatus {
  state: "trusted" | "confirmation_required" | "mismatch" | "unavailable";
  fingerprints: string[];
  message: string;
}

export const localTerminalEnvironment: TerminalEnvironment = { kind: "local" };

export function listSshEnvironments(): Promise<SshEnvironment[]> {
  return invoke<SshEnvironment[]>("terminal_ssh_environments");
}

export function preflightSshEnvironment(environmentId: string): Promise<SshHostKeyStatus> {
  return invoke<SshHostKeyStatus>("terminal_ssh_preflight", { environmentId });
}

export function trustSshHost(
  environmentId: string,
  fingerprint: string,
): Promise<SshHostKeyStatus> {
  return invoke<SshHostKeyStatus>("terminal_ssh_trust_host", {
    request: { environmentId, fingerprint },
  });
}

export function terminalEnvironmentRequest(environment: TerminalEnvironment) {
  return environment.kind === "ssh"
    ? { kind: "ssh" as const, id: environment.ssh.id }
    : { kind: "local" as const };
}

export function sshEnvironmentSummary(environment: SshEnvironment): string {
  const destination = environment.user
    ? `${environment.user}@${environment.host}`
    : environment.host;
  return environment.port === 22 ? destination : `${destination}:${environment.port}`;
}
