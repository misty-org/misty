import { ManagedAiRequestError } from "@/features/agents";
import type { ConnectedDevicesSnapshot } from "@/native/ipc";

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
  /** This device lets the peer change its files. */
  filesAcceptWrites: boolean;
  /** The peer lets this device change its files. */
  filesCanWrite: boolean;
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

export type DeviceLinkState = "connected" | "reconnecting" | "ended" | "new" | "offline";

/** How this device stands with a paired device. A session lasts the configured
 * number of days after an explicit connect; within it the devices reconnect on
 * their own, without Misty's server. */
export function deviceLink(
  peer: Pick<ServerConnectedPeer, "deviceId">,
  snapshot: ConnectedDevicesSnapshot | null,
): { state: DeviceLinkState; expiresAt: number | null } {
  const connected = snapshot?.peers.some(
    (native) => native.deviceId === peer.deviceId && native.state === "online",
  );
  const session = snapshot?.sessions?.find((item) => item.deviceId === peer.deviceId);
  const expiresAt = session?.outgoingExpiresAt ? session.outgoingExpiresAt * 1000 : null;
  if (connected) return { state: "connected", expiresAt };
  if (!session) return { state: "new", expiresAt: null };
  if (!expiresAt || expiresAt <= Date.now()) return { state: "ended", expiresAt: null };
  return { state: "reconnecting", expiresAt };
}

/** A pair that has never had a session connects once on its own, right after
 * pairing. Only one side starts it, so the two handshakes cannot cross. Ended
 * or expired sessions wait for the user to connect again. */
export function connectsAutomatically(
  peer: ServerConnectedPeer,
  snapshot: ConnectedDevicesSnapshot | null,
  localServerDeviceId: string,
): boolean {
  return (
    deviceLink(peer, snapshot).state === "new" &&
    peerIsOnline(peer) &&
    Boolean(peer.addressing) &&
    localServerDeviceId < peer.deviceId
  );
}

export function sessionRemainingLabel(expiresAt: number | null): string {
  if (!expiresAt) return "";
  const hours = Math.max(0, (expiresAt - Date.now()) / 3_600_000);
  if (hours < 1) return "ends within an hour";
  if (hours < 48) return `ends in ${Math.round(hours)} hours`;
  return `ends in ${Math.round(hours / 24)} days`;
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
