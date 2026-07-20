import { agentsDeviceSnapshot, agentsPrepareScopedDocument } from "./api";
import {
  ensureServerAgentDevice,
  heartbeatServerAgentDevice,
  signedAgentDeviceRequest,
} from "./deviceApi";
import { mistyDeviceJobsEnabled } from "./flags";
import type { AgentDevice } from "./types";

const leaseHeartbeatMs = 20_000;
const activePollMs = 750;
const idlePollMs = 4_000;
const hiddenPollMs = 15_000;
const nodeExecutionTimeoutMs = 60_000;

export interface ClaimedWorkflowNodeJob {
  job: {
    id: string;
    runId: string;
    nodeId: string;
    scopeId: string;
    operation: string;
    attempt: number;
    input: unknown;
    config: unknown;
  };
  leaseToken: string;
  leaseExpiresAt?: string | null;
}

export class DesktopAgentJobWorker {
  private stopped = true;
  private serverDeviceId: string | null = null;

  start(): void {
    if (!this.stopped || !mistyDeviceJobsEnabled()) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let waitMs = document.visibilityState === "hidden" ? hiddenPollMs : idlePollMs;
      try {
        const localDevice = await loadLocalAgentDevice();
        const serverDevice = await ensureServerAgentDevice(localDevice);
        this.serverDeviceId = serverDevice.id;
        const claim = await claimNextWorkflowNodeJob(serverDevice.id, localDevice.id);
        if (claim) {
          waitMs = activePollMs;
          await this.runWorkflowNodeClaim(claim, localDevice.id);
          continue;
        }
      } catch {
        // Offline and signed-out devices are expected. The coordinator keeps
        // the durable attempt and applies its normal retry/cooldown policy.
        waitMs = hiddenPollMs;
      }
      if (!this.stopped) await wait(waitMs);
    }
  }

  private async runWorkflowNodeClaim(
    claim: ClaimedWorkflowNodeJob,
    localDeviceId: string,
  ): Promise<void> {
    const deviceId = this.serverDeviceId;
    if (!deviceId) return;
    const base = `/devices/${encodeURIComponent(deviceId)}/workflow-node-jobs/${encodeURIComponent(claim.job.id)}`;
    const heartbeat = window.setInterval(() => {
      void signedAgentDeviceRequest(localDeviceId, `${base}/lease`, {
        method: "POST",
        body: JSON.stringify({ leaseToken: claim.leaseToken }),
      })
        .then(() => heartbeatServerAgentDevice(deviceId, localDeviceId))
        .catch(() => undefined);
    }, leaseHeartbeatMs);
    try {
      const output = await withTimeout(
        executeWorkflowNodeOnDevice(claim.job),
        nodeExecutionTimeoutMs,
      );
      await signedAgentDeviceRequest(localDeviceId, `${base}/complete`, {
        method: "POST",
        body: JSON.stringify({ leaseToken: claim.leaseToken, output }),
      });
    } catch (error) {
      await signedAgentDeviceRequest(localDeviceId, `${base}/fail`, {
        method: "POST",
        body: JSON.stringify({
          leaseToken: claim.leaseToken,
          errorCode: deviceWorkflowErrorCode(error),
        }),
      }).catch(() => undefined);
    } finally {
      window.clearInterval(heartbeat);
    }
  }
}

async function claimNextWorkflowNodeJob(
  deviceId: string,
  localDeviceId: string,
): Promise<ClaimedWorkflowNodeJob | null> {
  const claim = await signedAgentDeviceRequest<ClaimedWorkflowNodeJob | undefined>(
    localDeviceId,
    `/devices/${encodeURIComponent(deviceId)}/workflow-node-jobs/claim`,
    { method: "POST" },
  );
  return claim ?? null;
}

async function executeWorkflowNodeOnDevice(
  job: ClaimedWorkflowNodeJob["job"],
): Promise<Record<string, unknown>> {
  if (job.operation !== "read_content") {
    throw new Error(`unsupported_device_operation:${job.operation}`);
  }
  const ref = deviceContentReference(job.input, job.scopeId);
  const document = await agentsPrepareScopedDocument({
    scopeId: ref.scopeId,
    relativePath: ref.relativePath,
  });
  const content = {
    sourceKind: ref.sourceKind || "local_file",
    providerId: ref.providerId || "device",
    resourceId: ref.resourceId || `${ref.scopeId}:${ref.relativePath}`,
    version: ref.version || "",
    fingerprint: ref.fingerprint || "",
    mimeType: document.mimeType,
    displayName: document.displayName,
    locator: ref.relativePath,
    permissionScope: ref.scopeId,
  };
  return {
    content,
    sections: document.sections.map((section) => ({
      kind: section.kind,
      locator: section.locator,
      text: section.text,
    })),
    citations: document.sections.map((section) => ({
      content,
      kind: section.kind,
      locator: section.locator,
      excerpt: section.text.slice(0, 240),
    })),
    truncated: document.truncated,
    sourceChanged: false,
  };
}

export function deviceContentReference(
  input: unknown,
  expectedScopeId: string,
): Record<string, string> {
  const ref = findDeviceContentReference(input);
  if (
    !ref ||
    ref.scopeId !== expectedScopeId ||
    !ref.relativePath ||
    ref.relativePath.startsWith("/") ||
    ref.relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("invalid_device_scope");
  }
  return { ...ref, scopeId: expectedScopeId, relativePath: ref.relativePath };
}

function findDeviceContentReference(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = (record.contentRef ?? record.content) as Record<string, unknown> | undefined;
  const source = candidate && typeof candidate === "object" ? candidate : record;
  const scopeId = stringValue(source.scopeId) || stringValue(source.permissionScope);
  const relativePath = stringValue(source.relativePath) || stringValue(source.locator);
  if (scopeId && relativePath) {
    return {
      ...Object.fromEntries(
        Object.entries(source).map(([key, entry]) => [key, stringValue(entry)]),
      ),
      scopeId,
      relativePath,
    };
  }
  for (const child of Object.values(record)) {
    const found = findDeviceContentReference(child);
    if (found) return found;
  }
  return null;
}

export function deviceWorkflowErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("unsupported_content")) return "unsupported_content";
  if (message.includes("invalid_device_scope")) return "invalid_scope";
  if (message.includes("unsupported_device_operation")) return "unsupported_operation";
  if (message.includes("device_node_timeout")) return "device_timeout";
  return "device_execution_failed";
}

async function loadLocalAgentDevice(): Promise<AgentDevice> {
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked") {
    throw new Error("This Misty device is unavailable.");
  }
  return snapshot.device;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("device_node_timeout")), timeoutMs);
    operation.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
