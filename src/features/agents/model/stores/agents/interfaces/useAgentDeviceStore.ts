export interface ServerTrustedDevice {
  id: string;
  name: string;
  publicKey?: string;
  revokedAt?: string | null;
}

export interface ServerDeviceList {
  devices: ServerTrustedDevice[];
}

export interface StoredDeviceIdentity {
  publicKey: string;
  privateKey: string;
}
