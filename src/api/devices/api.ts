import { managedAiRequest } from "@/api/ai/managed";

export type SignedDeviceRequest = <T>(
  localDeviceId: string,
  path: string,
  init: RequestInit,
) => Promise<T>;

const devicePath = (deviceId: string) => `/devices/${encodeURIComponent(deviceId)}`;
const pairingPath = (deviceId: string, sessionId: string) =>
  `${devicePath(deviceId)}/pairing-sessions/${encodeURIComponent(sessionId)}`;
const pairPath = (deviceId: string, pairId: string) =>
  `${devicePath(deviceId)}/pairs/${encodeURIComponent(pairId)}`;
const workflowJobPath = (deviceId: string, jobId: string) =>
  `${devicePath(deviceId)}/workflow-node-jobs/${encodeURIComponent(jobId)}`;

export interface SpaceDevicePresenceInput {
  installedVersion: string;
  authorityGeneration: number;
  endpointId: string;
  addressing: Record<string, unknown>;
  protocolVersion: "misty-device/2";
  connectionHint: "unknown" | "direct" | "relay";
}
const spaceDevicePath = (deviceId: string, spaceId: string) => {
  if (!spaceId.trim()) throw new Error("A Space is required for peer access.");
  return `${devicePath(deviceId)}/spaces/${encodeURIComponent(spaceId)}`;
};

export const devicesApi = {
  request: managedAiRequest,
  list: <T>() => managedAiRequest<T>("/devices"),
  register: <T>(body: unknown, signal?: AbortSignal) =>
    managedAiRequest<T>("/devices", { method: "POST", body: JSON.stringify(body), signal }),
  peerTicketKeys: <T>() => managedAiRequest<T>("/devices/peer-ticket-keys"),
  heartbeat: <T>(request: SignedDeviceRequest, localId: string, deviceId: string, body: unknown) =>
    signed<T>(request, localId, `${devicePath(deviceId)}/heartbeat`, "POST", body),
  presence: <T>(request: SignedDeviceRequest, localId: string, deviceId: string, body: unknown) =>
    signed<T>(request, localId, `${devicePath(deviceId)}/presence`, "POST", body),
  peers: <T>(request: SignedDeviceRequest, localId: string, deviceId: string) =>
    signed<T>(request, localId, `${devicePath(deviceId)}/peers`, "GET"),
  issuePeerTicket: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    body: unknown,
  ) => signed<T>(request, localId, `${devicePath(deviceId)}/peer-tickets`, "POST", body),
  spacePresence: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    spaceId: string,
    body: SpaceDevicePresenceInput,
  ) => signed<T>(request, localId, `${spaceDevicePath(deviceId, spaceId)}/presence`, "POST", body),
  spacePeers: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    spaceId: string,
  ) => signed<T>(request, localId, `${spaceDevicePath(deviceId, spaceId)}/peers`, "GET"),
  issueSpacePeerTicket: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    spaceId: string,
    targetDeviceId: string,
  ) =>
    signed<T>(request, localId, `${spaceDevicePath(deviceId, spaceId)}/peer-tickets`, "POST", {
      targetDeviceId,
      protocolVersion: "misty-device/2",
    }),
  registerPushSubscription: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    body: { mistyDeviceId: string; environment: "sandbox" | "production"; token: string },
  ) => signed(request, localId, `${devicePath(deviceId)}/push-subscription`, "PUT", body),
  deletePushSubscription: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    body: { mistyDeviceId: string; environment: "sandbox" | "production"; token: string },
  ) => signed(request, localId, `${devicePath(deviceId)}/push-subscription`, "DELETE", body),
  createPairing: <T>(request: SignedDeviceRequest, localId: string, deviceId: string) =>
    signed<T>(request, localId, `${devicePath(deviceId)}/pairing-sessions`, "POST", {}),
  redeemPairing: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    body: unknown,
  ) => signed<T>(request, localId, `${devicePath(deviceId)}/pairing/redeem`, "POST", body),
  pairing: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    sessionId: string,
  ) => signed<T>(request, localId, pairingPath(deviceId, sessionId), "GET"),
  confirmPairing: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    sessionId: string,
  ) => signed(request, localId, `${pairingPath(deviceId, sessionId)}/confirm`, "POST", {}),
  setClipboardConsent: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    pairId: string,
    enabled: boolean,
  ) =>
    signed(request, localId, `${pairPath(deviceId, pairId)}/clipboard-consent`, "PUT", {
      enabled,
    }),
  renamePair: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    pairId: string,
    name: string,
  ) => signed(request, localId, `${pairPath(deviceId, pairId)}/name`, "PUT", { name }),
  revokePair: (request: SignedDeviceRequest, localId: string, deviceId: string, pairId: string) =>
    signed(request, localId, `${pairPath(deviceId, pairId)}/revoke`, "POST", {}),
  claimWorkflowJob: <T>(request: SignedDeviceRequest, localId: string, deviceId: string) =>
    signed<T>(request, localId, `${devicePath(deviceId)}/workflow-node-jobs/claim`, "POST", {
      protocolVersion: 2,
    }),
  beginWorkflowJob: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    jobId: string,
    leaseToken: string,
  ) =>
    signed<T>(request, localId, `${workflowJobPath(deviceId, jobId)}/begin`, "POST", {
      leaseToken,
    }),
  uncertainWorkflowJob: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    jobId: string,
    body: unknown,
  ) => signed(request, localId, `${workflowJobPath(deviceId, jobId)}/uncertain`, "POST", body),
  renewWorkflowJobLease: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    jobId: string,
    leaseToken: string,
  ) =>
    signed<T>(request, localId, `${workflowJobPath(deviceId, jobId)}/lease`, "POST", {
      leaseToken,
    }),
  completeWorkflowJob: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    jobId: string,
    body: unknown,
  ) => signed(request, localId, `${workflowJobPath(deviceId, jobId)}/complete`, "POST", body),
  failWorkflowJob: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    jobId: string,
    body: unknown,
  ) => signed(request, localId, `${workflowJobPath(deviceId, jobId)}/fail`, "POST", body),
};

function signed<T>(
  request: SignedDeviceRequest,
  localId: string,
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  return request<T>(localId, path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
