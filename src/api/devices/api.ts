import { managedAiRequest } from "@/api/ai/managed";

export type SignedDeviceRequest = <T>(
  localDeviceId: string,
  path: string,
  init: RequestInit,
) => Promise<T>;

const devicePath = (deviceId: string) => `/devices/${encodeURIComponent(deviceId)}`;
const workflowJobPath = (deviceId: string, jobId: string) =>
  `${devicePath(deviceId)}/workflow-node-jobs/${encodeURIComponent(jobId)}`;

export const devicesApi = {
  request: managedAiRequest,
  list: <T>() => managedAiRequest<T>("/devices"),
  register: <T>(body: unknown, signal?: AbortSignal) =>
    managedAiRequest<T>("/devices", { method: "POST", body: JSON.stringify(body), signal }),
  peerTicketKeys: <T>() => managedAiRequest<T>("/devices/peer-ticket-keys"),
  heartbeat: <T>(request: SignedDeviceRequest, localId: string, deviceId: string, body: unknown) =>
    signed<T>(request, localId, `${devicePath(deviceId)}/heartbeat`, "POST", body),
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
