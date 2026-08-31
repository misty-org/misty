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

export const devicesApi = {
  request: managedAiRequest,
  list: <T>() => managedAiRequest<T>("/devices"),
  register: <T>(body: unknown) =>
    managedAiRequest<T>("/devices", { method: "POST", body: JSON.stringify(body) }),
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
    signed<T>(request, localId, `${devicePath(deviceId)}/workflow-node-jobs/claim`, "POST"),
  renewWorkflowJobLease: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    jobId: string,
    leaseToken: string,
  ) =>
    signed(request, localId, `${workflowJobPath(deviceId, jobId)}/lease`, "POST", { leaseToken }),
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
