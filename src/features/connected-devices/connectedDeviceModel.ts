import type { DevicePolicy } from "@/native/devices";

/** One of the account's signed-in sessions, as the server lists it. */
export interface AccountDevice {
  id: string;
  name: string;
  platform: string;
  publicKey: string;
  admissionState: "admitted" | "revoked";
  osVersion: string;
  appVersion: string;
  lastSeenAt: string;
  createdAt: string;
  policy?: Omit<DevicePolicy, "version"> & { version: number; updatedAt: string };
}
