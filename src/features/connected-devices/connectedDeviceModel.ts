import { ManagedAiRequestError } from "@/features/agents";

export interface ServerConnectedPeer {
  pairId: string;
  deviceId: string;
  name: string;
  platform: string;
  p2pEndpointId: string;
  protocolVersions: string[];
  addressing: unknown;
  protocolVersion?: string;
  connectionHint: "unknown" | "direct" | "relay";
  lastHeartbeatAt?: string | null;
  clipboardCanSend: boolean;
  clipboardCanReceive: boolean;
}

export interface PairingSession {
  id: string;
  creatorDeviceId: string;
  requesterDeviceId?: string;
  state: "pending" | "redeemed" | "confirmed" | "expired" | "locked";
  expiresAt: string;
  creatorName: string;
  requesterName?: string;
}

export interface PairingView {
  session: PairingSession;
  manualCode?: string;
  deepLink?: string;
  fingerprint?: string;
}

export function connectedDevicesErrorMessage(cause: unknown): string {
  if (cause instanceof ManagedAiRequestError) {
    if (cause.status === 404) return "Connected Devices isn’t enabled on this Misty server.";
    if (cause.status === 503) return "Connected Devices is temporarily unavailable.";
    // Cloudflare edge failures (e.g. 1033: tunnel offline) arrive as a bare
    // "error code: NNNN" body. That means the server is unreachable, not broken.
    if (cause.status === 530 || /^error code: \d+$/i.test(cause.message.trim())) {
      return "Can’t reach the Misty server right now. Misty will keep retrying.";
    }
  }
  return cause instanceof Error ? cause.message : "Connected Devices is unavailable.";
}

export function peerIsOnline(peer: ServerConnectedPeer): boolean {
  const heartbeat = peer.lastHeartbeatAt ? Date.parse(peer.lastHeartbeatAt) : 0;
  return heartbeat > Date.now() - 90_000;
}

export function connectedDevicePlatform(): "macos" | "windows" | "linux" | "unknown" {
  const value = navigator.userAgent.toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
  if (value.includes("linux")) return "linux";
  return "unknown";
}

export function parsePairingInput(input: string): {
  sessionId?: string;
  secret?: string;
  code?: string;
} {
  const value = input.trim();
  if (value.startsWith("misty://")) {
    const url = new URL(value);
    return {
      sessionId: url.searchParams.get("session") || undefined,
      secret: url.searchParams.get("secret") || undefined,
    };
  }
  return { code: value.toUpperCase().replace(/[^A-Z2-7]/g, "") };
}
