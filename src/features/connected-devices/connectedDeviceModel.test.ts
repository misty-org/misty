import type { ConnectedDevicesSnapshot } from "@/native/ipc";
import { describe, expect, it } from "vitest";
import {
  connectsAutomatically,
  deviceLink,
  type ServerConnectedPeer,
} from "./connectedDeviceModel";

const nowSeconds = () => Math.floor(Date.now() / 1000);

function peer(deviceId: string): ServerConnectedPeer {
  return {
    pairId: `pair_${deviceId}`,
    deviceId,
    name: deviceId,
    platform: "macos",
    p2pEndpointId: "endpoint",
    protocolVersions: [],
    addressing: { id: "endpoint" },
    connectionHint: "unknown",
    lastHeartbeatAt: new Date().toISOString(),
    clipboardCanSend: false,
    clipboardCanReceive: false,
    filesAcceptWrites: false,
    filesCanWrite: false,
  };
}

function snapshot(
  sessions: ConnectedDevicesSnapshot["sessions"],
  online: string[] = [],
): ConnectedDevicesSnapshot {
  return {
    enabled: true,
    endpointId: "self",
    addressing: null,
    relayPolicy: "lan-only",
    peers: online.map((deviceId) => ({
      deviceId,
      state: "online",
      connectionType: "direct",
      authorizationExpiresAt: nowSeconds() + 3600,
    })),
    sessions,
    unavailableReason: null,
  };
}

describe("device links", () => {
  it("separates a new pair, a live session and an ended one", () => {
    const later = nowSeconds() + 86_400;
    expect(deviceLink(peer("device_b"), snapshot([])).state).toBe("new");
    expect(
      deviceLink(
        peer("device_b"),
        snapshot([{ deviceId: "device_b", outgoingExpiresAt: later, incomingExpiresAt: later }]),
      ).state,
    ).toBe("reconnecting");
    expect(
      deviceLink(
        peer("device_b"),
        snapshot(
          [{ deviceId: "device_b", outgoingExpiresAt: later, incomingExpiresAt: later }],
          ["device_b"],
        ),
      ).state,
    ).toBe("connected");
    expect(
      deviceLink(
        peer("device_b"),
        snapshot([{ deviceId: "device_b", outgoingExpiresAt: 0, incomingExpiresAt: 0 }]),
      ).state,
    ).toBe("ended");
  });

  it("starts only new pairs on their own, from one side", () => {
    const empty = snapshot([]);
    expect(connectsAutomatically(peer("device_b"), empty, "device_a")).toBe(true);
    expect(connectsAutomatically(peer("device_a"), empty, "device_b")).toBe(false);
    const ended = snapshot([{ deviceId: "device_b", outgoingExpiresAt: 0, incomingExpiresAt: 0 }]);
    expect(connectsAutomatically(peer("device_b"), ended, "device_a")).toBe(false);
  });
});
