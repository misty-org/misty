import { describe, expect, it } from "vitest";
import type { ChannelSnapshot } from "@/native/devices";
import { devicePeers, deviceStatusLabel, type AccountDevice } from "./connectedDeviceModel";

const device = (
  id: string,
  name: string,
  admissionState: AccountDevice["admissionState"] = "admitted",
): AccountDevice => ({
  id,
  name,
  platform: "macos",
  publicKey: "",
  admissionState,
  osVersion: "",
  appVersion: "",
  lastSeenAt: "2026-10-05T00:00:00Z",
  createdAt: "2026-10-05T00:00:00Z",
});

const channel = (peers: ChannelSnapshot["peers"]): ChannelSnapshot => ({
  connected: true,
  admitted: true,
  networkKey: "home",
  overlay: false,
  peers,
});

describe("device peers", () => {
  it("lists this device first and labels each other device by network", () => {
    const peers = devicePeers(
      [device("b", "Studio"), device("self", "Laptop"), device("c", "Office"), device("d", "Old")],
      "self",
      channel([
        { deviceId: "b", endpointId: "", online: true, networkKey: "home", overlay: false },
        { deviceId: "c", endpointId: "", online: true, networkKey: "work", overlay: false },
      ]),
      [],
      new Set(),
    );
    expect(peers.map((peer) => [peer.name, deviceStatusLabel(peer.status)])).toEqual([
      ["Laptop", "This device"],
      ["Office", "Other network"],
      ["Old", "Offline"],
      ["Studio", "Same network"],
    ]);
  });

  it("omits devices that are not added, and reports unreachable dials", () => {
    const peers = devicePeers(
      [device("self", "Laptop"), device("p", "Pending", "pending"), device("c", "Office")],
      "self",
      channel([
        { deviceId: "c", endpointId: "", online: true, networkKey: "work", overlay: false },
      ]),
      [],
      new Set(["c"]),
    );
    expect(peers.map((peer) => peer.id)).toEqual(["self", "c"]);
    expect(deviceStatusLabel(peers[1].status)).toBe("Can't reach");
  });

  it("treats a shared overlay network as the same network", () => {
    const [, peer] = devicePeers(
      [device("self", "Laptop"), device("t", "Tailnet")],
      "self",
      {
        ...channel([
          { deviceId: "t", endpointId: "", online: true, networkKey: "elsewhere", overlay: true },
        ]),
        overlay: true,
      },
      [],
      new Set(),
    );
    expect(peer.status).toBe("same-network");
  });
});
