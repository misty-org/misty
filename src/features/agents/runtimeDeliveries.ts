import { invoke } from "@tauri-apps/api/core";
import { subscribeAccountEvents } from "@/api/account-events";
import { resolveApiBase } from "@/api/deployment/api";
import { devicesApi } from "@/api/devices/api";
import { diag } from "./diagnostics";
import { recheckRunningJobs } from "./runningJobs";
import { ensureServerAgentDevice, signedAgentDeviceRequest } from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";

/** A run the server queued for this device (agent_runtime_device.go). */
interface RuntimeDelivery {
  id: string;
  lease_id: string;
  operation: string;
  run_id: string;
}

/** What the agent runtime on this computer did with it (agent_runtime/calls.rs). */
interface RuntimeOutcome {
  runtime_run_id?: string;
  status?: string;
  error?: string;
}

const claimHoldMs = 25_000;

/**
 * Agent runs work on this computer (docs/agents/runtime.md). The server queues each run
 * this device keeps, and its cancels and resumes; this worker claims them, holding the claim
 * open so a new run starts the moment it is sent, hands each to the agent runtime on this
 * computer, and reports what it did.
 */
export class RuntimeDeliveryWorker {
  private running = false;
  private generation = 0;
  private hold?: AbortController;
  private unsubscribe?: () => void;
  private failures = 0;
  private wakeUp?: () => void;

  start(accountId: string): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    // A held claim already hears queued runs; the feed only cuts short a wait after an error.
    this.unsubscribe = subscribeAccountEvents(accountId, (event) => {
      if (event.topic === "runtime" || event.topic === "reset") this.wakeUp?.();
    });
    void this.loop(generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.unsubscribe?.();
    this.hold?.abort();
    this.wakeUp?.();
  }

  private async loop(generation: number): Promise<void> {
    const current = () => this.running && this.generation === generation;
    while (current()) {
      try {
        const snapshot = await agentsDeviceSnapshot();
        if (!snapshot.device || snapshot.device.status === "revoked")
          throw new Error("This signed-in session is unavailable.");
        const local = snapshot.device;
        const device = await ensureServerAgentDevice(local);
        while (current()) {
          this.hold = new AbortController();
          const claim = await devicesApi.claimRuntimeDeliveries<
            { deliveries: RuntimeDelivery[] } | undefined
          >(signedAgentDeviceRequest, local.id, device.id, {
            waitMs: claimHoldMs,
            signal: this.hold.signal,
          });
          this.failures = 0;
          if (!current()) return;
          for (const delivery of claim?.deliveries ?? [])
            await this.deliver(delivery, local.id, device.id);
        }
      } catch (error) {
        if (!current()) return;
        diag("runtime", `claim failed: ${String(error)}`);
        const delay =
          Math.min(60_000, 2_000 * 2 ** Math.min(this.failures++, 5)) + Math.random() * 1000;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          this.wakeUp = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.wakeUp = undefined;
      }
    }
  }

  private async deliver(
    delivery: RuntimeDelivery,
    localId: string,
    deviceId: string,
  ): Promise<void> {
    let outcome: RuntimeOutcome;
    try {
      outcome = await invoke<RuntimeOutcome>("agent_runtime_deliver", {
        delivery,
        server: await resolveApiBase(),
      });
    } catch (error) {
      // The runtime couldn't be started or reached: the server retries the delivery.
      diag("runtime", `${delivery.operation} not delivered: ${String(error)}`);
      outcome = { error: "agent_runtime_unavailable" };
    }
    diag("runtime", `${delivery.operation} ${delivery.run_id} ${outcome.error ?? "ok"}`);
    // The run's own job, such as a shell command, shouldn't work on until its next heartbeat.
    if (delivery.operation === "runtime.cancel") recheckRunningJobs();
    // Retry only the report of what happened, never the delivery itself.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await devicesApi.finishRuntimeDelivery(
          signedAgentDeviceRequest,
          localId,
          deviceId,
          delivery.id,
          {
            lease_id: delivery.lease_id,
            ...outcome,
          },
        );
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
}
