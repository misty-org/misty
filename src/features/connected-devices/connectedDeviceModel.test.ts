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
  peers,
});

describe("device peers", () => {
  it("lists this device first and labels each other device by presence", () => {
    const peers = devicePeers(
      [device("b", "Studio"), device("self", "Laptop"), device("c", "Office"), device("d", "Old")],
      "self",
      channel([
        { deviceId: "b", online: true },
        { deviceId: "c", online: false },
      ]),
    );
    expect(peers.map((peer) => [peer.name, deviceStatusLabel(peer.status)])).toEqual([
      ["Laptop", "This device"],
      ["Office", "Offline"],
      ["Old", "Offline"],
      ["Studio", "Online"],
    ]);
  });

  it("omits devices that are not added", () => {
    const peers = devicePeers(
      [device("self", "Laptop"), device("p", "Pending", "pending"), device("c", "Office")],
      "self",
      channel([{ deviceId: "c", online: true }]),
    );
    expect(peers.map((peer) => peer.id)).toEqual(["self", "c"]);
    expect(peers[1].status).toBe("online");
  });

  it("counts every other device offline without a channel", () => {
    const peers = devicePeers([device("self", "Laptop"), device("c", "Office")], "self", null);
    expect(peers.map((peer) => peer.status)).toEqual(["self", "offline"]);
  });
});
