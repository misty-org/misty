import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ApiRequestError, apiRequest } from "@/api/client";
import { resolveSetting, useDevicePreferences } from "@/features/settings";
import { appsApi } from "../apps/api";

/**
 * Runs a coding task the server delegated to this device: picks the tool (the
 * person's default, then fallback), takes a lease per turn, runs turns
 * until the tool finishes, mirrors every event to the delegated run and gets
 * the person's answer to each permission question through the server's card.
 * The device job itself only starts the run.
 */
interface CodingJob {
  id: string;
  scopeId: string;
  input?: unknown;
}

interface Lease {
  invocation_id: string;
  lease_id: string;
  expires_at: number;
  grant_version: number;
  grants: string[];
  signature: string;
}

interface RunnerEvent {
  type: string;
  text?: string;
  id?: string;
  [key: string]: unknown;
}

interface Ask {
  id: string;
  runId: string;
  action: string;
  request: { id: string; tool: string; kind: string; path?: string; command?: string };
}

class LeaseRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const setting = (id: string) => {
  const state = useDevicePreferences.getState().state;
  const value = state ? String(resolveSetting(state, id).value) : "none";
  return value === "none" ? undefined : value;
};

const codingPath = (runId: string, path: string) =>
  `/me/coding/${encodeURIComponent(runId)}/${path}`;

async function postEvents(runId: string, lease: Lease | undefined, events: RunnerEvent[]) {
  await apiRequest(codingPath(runId, "events"), {
    method: "POST",
    body: JSON.stringify({
      lease_id: lease?.lease_id ?? "",
      token: lease?.signature ?? "",
      events,
    }),
  });
}

async function takeLease(runId: string, deviceId: string, engine: string, repo: string | null) {
  try {
    return (
      await apiRequest<{ lease: Lease }>(codingPath(runId, "lease"), {
        method: "POST",
        body: JSON.stringify({ device_id: deviceId, engine, model: "", repo: repo ?? "" }),
      })
    ).lease;
  } catch (error) {
    if (error instanceof ApiRequestError)
      throw new LeaseRefused(error.code ?? "lease_failed", error.message);
    throw new LeaseRefused(
      "lease_failed",
      "Misty couldn’t reach the server to start the coding tool.",
    );
  }
}

/** Waits for the person's answer on the server's card; no answer is a no. */
async function answerAsk(ask: Ask, lease: Lease, repo: string | null) {
  let allow = false;
  try {
    const result = await apiRequest<{ decision: string; request_id?: string }>(
      codingPath(ask.runId, "approvals"),
      {
        method: "POST",
        body: JSON.stringify({
          lease_id: lease.lease_id,
          token: lease.signature,
          id: ask.request.id,
          action: ask.action,
          tool: ask.request.tool,
          path: ask.request.path ?? "",
          command: ask.request.command ?? "",
          repo: repo ?? "",
        }),
      },
    );
    allow = result.decision === "allow";
    for (let i = 0; result.decision === "pending" && result.request_id && i < 300; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const { request } = await appsApi.request(result.request_id);
      if (request.state === "pending") continue;
      allow = request.state === "approved" || request.state === "used";
      break;
    }
  } finally {
    await invoke("coding_runner_answer", { id: ask.id, allow }).catch(() => undefined);
  }
}

async function runTurns(job: CodingJob, deviceId: string) {
  const input = (job.input ?? {}) as {
    childInvocationId?: string;
    task?: string;
    mode?: string;
    permissionMode?: string;
    /** The tool the person picked for this chat; empty uses the Settings default. */
    tool?: string;
    agentId?: string;
    conversationId?: string;
  };
  const runId = String(input.childInvocationId ?? "");
  const permission = input.permissionMode === "auto" ? "auto" : "ask";
  const fail = (message: string) =>
    postEvents(runId, undefined, [{ type: "error", message }]).catch(() => undefined);
  if (!runId || !input.task) return;
  await apiRequest("/me/coding/engines", {
    method: "PUT",
    body: JSON.stringify({ device_id: deviceId, engines: await invoke("coding_engines_detect") }),
  }).catch(() => undefined);
  const repo = await invoke<string | null>("coding_project_remote", { scopeId: job.scopeId }).catch(
    () => null,
  );
  const exclude: string[] = [];
  let engine = "";
  let lease: Lease | undefined;
  while (!lease) {
    try {
      const cap = setting("agents.coding_usage_cap");
      engine = await invoke<string>("coding_route", {
        request: {
          // A tool picked for this chat runs alone: if it can't run, the run stops
          // rather than quietly switching to another tool.
          default: input.tool || setting("agents.coding_default_tool"),
          fallback: input.tool ? "none" : setting("agents.coding_fallback_tool"),
          capPercent: cap ? Number(cap) : undefined,
          mode: input.mode === "plan" ? "plan" : "edit",
          permission,
          exclude,
        },
      });
      lease = await takeLease(runId, deviceId, engine, repo);
    } catch (error) {
      if (error instanceof LeaseRefused && error.code === "engine_not_allowed") {
        exclude.push(engine);
        continue;
      }
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  let seq = 0;
  let session: string | undefined;
  let text = "";
  let sentMessage = false;
  let posting = Promise.resolve();
  let current = lease;
  const unlistenEvents = await listen<{ runId: string; events: RunnerEvent[] }>(
    "misty://coding-events",
    ({ payload }) => {
      if (payload.runId !== runId) return;
      const events: RunnerEvent[] = [];
      for (const event of payload.events) {
        if (event.type === "session") session = String(event.id ?? "");
        if (event.type === "delta") text += event.text ?? "";
        if (event.type === "message") sentMessage = true;
        // The run's answer is the tool's final text, sent once before it ends.
        if (event.type === "done" && !sentMessage && text.trim())
          events.push({ type: "message", text, seq: ++seq });
        events.push({ ...event, seq: ++seq });
      }
      posting = posting.then(() => postEvents(runId, current, events)).catch(() => undefined);
    },
  );
  const unlistenAsk = await listen<Ask>("misty://coding-ask", ({ payload }) => {
    if (payload.runId === runId) void answerAsk(payload, current, repo);
  });
  try {
    let task = String(input.task);
    for (;;) {
      const result = await invoke<{ outcome: string; message?: string }>("coding_run_turn", {
        request: {
          runId,
          scopeId: job.scopeId,
          engine,
          task,
          mode: input.mode === "plan" ? "plan" : "edit",
          permission,
          session,
          lease: current,
        },
      });
      await posting;
      if (result.outcome === "finished" && input.mode !== "plan")
        await saveSnapshot(job.scopeId, runId, input.agentId, input.conversationId);
      if (result.outcome !== "lease_expired") {
        if (result.outcome === "failed")
          await fail(result.message || "The coding tool stopped with an error.");
        if (result.outcome === "canceled") await fail("Stopped before the coding tool finished.");
        return;
      }
      // An expired lease stops at the turn boundary; a new one continues the session.
      current = await takeLease(runId, deviceId, engine, repo);
      task = "Continue where you left off.";
    }
  } catch (error) {
    await fail(
      error instanceof LeaseRefused ? error.message : "The coding run stopped unexpectedly.",
    );
  } finally {
    unlistenEvents();
    unlistenAsk();
  }
}

/**
 * Saves a snapshot of the project to the agent's Space after a run that could
 * change it, so the Space keeps what it built. Misty's own agent has no Space.
 * A failure only means no snapshot; the chat offers to save one again.
 */
async function saveSnapshot(
  scopeId: string,
  runId: string,
  agentId?: string,
  conversationId?: string,
) {
  if (!agentId || agentId === "misty-unified") return;
  const { saveProjectSnapshot } = await import("../agentArtifacts");
  await saveProjectSnapshot({ agentId, scopeId, runId, conversationId }).catch(() => undefined);
}

/** Starts the run and finishes the device job; the run reports on its own. */
export async function startCodingRun(
  job: CodingJob,
  deviceId: string,
): Promise<Record<string, unknown>> {
  void runTurns(job, deviceId);
  return { started: true };
}
