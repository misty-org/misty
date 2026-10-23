import { managedAiRequest } from "@/api/ai/managed";

type SignedDeviceRequest = <T>(
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
  heartbeat: <T>(request: SignedDeviceRequest, localId: string, deviceId: string, body: unknown) =>
    signed<T>(request, localId, `${devicePath(deviceId)}/heartbeat`, "POST", body),
  /** With waitMs the server holds the claim until a job is queued (at most 25 s). */
  claimWorkflowJob: <T>(
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    hold?: { waitMs: number; signal: AbortSignal },
  ) =>
    request<T>(localId, `${devicePath(deviceId)}/workflow-node-jobs/claim`, {
      method: "POST",
      body: JSON.stringify(
        hold ? { protocolVersion: 2, waitMs: hold.waitMs } : { protocolVersion: 2 },
      ),
      signal: hold?.signal,
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
  /** Puts back a claimed job that never began, so the next claim takes it at once. */
  releaseWorkflowJob: (
    request: SignedDeviceRequest,
    localId: string,
    deviceId: string,
    jobId: string,
    leaseToken: string,
  ) =>
    signed(request, localId, `${workflowJobPath(deviceId, jobId)}/release`, "POST", { leaseToken }),
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
