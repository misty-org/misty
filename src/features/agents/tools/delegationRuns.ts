import { aiSurfaceApi } from "../runs/invocations/api";
import { readRunFollow } from "../runs/invocations/invocationSubscription";
import { followLocalRunEvents, publishLocalRunEvent } from "../runs/local-run/localRunEvents";
import type {
  AgentSubagent,
  AiInvocationDeviceContext,
  AiInvocationEvent,
} from "../runs/invocations/invocationTypes";
import { invoke } from "@/native/invoke";
import { buildDeviceJob, deviceJobMs, settleDeviceJob } from "./deviceJob";
import { LocalToolRejected, type LocalToolHandler, type LocalToolRequest } from "./host";
import { loadRunEntry, openedTabs, type RunEntry } from "./runContexts";
import { notebookKey } from "./run-state/notebook";
import type { Child, Task } from "./delegationTools";
import {
  checkMs,
  childrenOf,
  clip,
  delegatedPrompt,
  finished,
  holdMs,
  invalid,
  maxAnswer,
  parseTasks,
  saveChildren,
  summaryLength,
  viewLabel,
} from "./delegationTools";

async function spawnTabs(
  request: LocalToolRequest,
  entry: RunEntry,
  labels: string[],
): Promise<AiInvocationDeviceContext[]> {
  const scope = entry.contexts.find(
    (item) => item.kind === "browser_tab" && item.capabilities.includes("browser.spawn_tabs"),
  );
  if (!scope) return [];
  const taskId = typeof scope.metadata.task_id === "string" ? scope.metadata.task_id : entry.taskId;
  const job = buildDeviceJob({
    entry,
    context: scope,
    callId: request.callId,
    node: "delegate_tabs",
    operation: "browser.spawn_tabs",
    input: {
      scopeId: scope.opaqueRef,
      count: labels.length,
      labels,
      conversationId: entry.conversationId,
    },
    config: { agentId: entry.agentId || "misty-unified", taskId },
    waitMs: deviceJobMs,
  });
  const outcome = await settleDeviceJob(job, request.signal);
  const tabs = outcome.ok ? openedTabs(outcome.output.tabs, scope.deviceId, labels.length) : null;
  if (!tabs)
    throw invalid(
      "Misty could not open browser tabs for the sub-agents. Call agent_delegate with browser false to run them without one.",
    );
  return tabs;
}

async function startChild(
  entry: RunEntry,
  callId: string,
  index: number,
  task: Task,
  tab: AiInvocationDeviceContext | undefined,
): Promise<string> {
  const created = await aiSurfaceApi.createInvocation({
    mode: "drawer",
    surfaceId: "global",
    trigger: "delegated",
    prompt: delegatedPrompt(task),
    context: [],
    agentId: entry.agentId,
    spaceId: entry.spaceId,
    executionMode: (entry.executionMode || "user") as "user" | "agent",
    taskId: entry.taskId || undefined,
    windowLabel: entry.windowLabel || undefined,
    collaborationMode: (entry.collaborationMode || undefined) as
      "act" | "plan" | "teach" | undefined,
    permissionMode: entry.permissionMode,
    idempotencyKey: `delegate:${entry.runId}:${callId}:${index}`,
    delegatedFrom: entry.runId,
    parentRunId: entry.runId,
    notebookKey: notebookKey(entry.runId, {
      account: entry.account,
      conversationId: entry.conversationId,
      notebookKey: entry.notebookKey,
    }),
    deviceContexts: tab ? [tab] : [],
  });
  return created.invocationId;
}

/** A child's state and answer as far as its kept events say. A later look never undoes an ending. */
async function refresh(child: Child): Promise<Child> {
  if (finished(child.state)) return child;
  const follow = await readRunFollow(child.runId).catch(() => null);
  if (!follow) return child;
  const said = follow.events.flatMap((event: AiInvocationEvent) =>
    event.type === "assistant.message" ? [event.text] : [],
  );
  const failed = follow.events.find((event) => event.type === "invocation.failed");
  return {
    ...child,
    state: follow.state,
    answer: said[said.length - 1] ?? child.answer,
    error: failed?.type === "invocation.failed" ? failed.error : child.error,
  };
}

function resultOf(children: Child[], running: number) {
  const subagents = children.map((child) => {
    const item: Record<string, unknown> = {
      task: child.taskIndex + 1,
      goal: child.goal,
      state: child.state,
    };
    const answer = child.answer.trim();
    if (answer) {
      let parsed: unknown;
      if (child.outputSchema) {
        const start = answer.indexOf("{");
        const end = answer.lastIndexOf("}");
        try {
          if (start >= 0 && end > start) parsed = JSON.parse(answer.slice(start, end + 1));
        } catch {
          parsed = undefined;
        }
      }
      if (parsed !== undefined) item.output = parsed;
      else item.answer = clip(answer, maxAnswer);
    }
    if (child.state === "failed" && child.error) item.error = child.error;
    return item;
  });
  return {
    subagents,
    still_running: running,
    contentTrust: "untrusted-subagent-output",
    ...(running > 0
      ? { next: "Some sub-agents are still working. Do other work or call agent_wait." }
      : {}),
  };
}

/** Shows the parent's sub-agents in its chat. */
function publishChildren(parent: string, children: Child[]) {
  const shown: AgentSubagent[] = children.map((child) => ({
    invocationId: child.runId,
    goal: clip(child.goal, 300),
    state: child.state,
    ...(finished(child.state) && child.answer
      ? { summary: clip(child.answer.split(/\s+/).filter(Boolean).join(" "), summaryLength) }
      : {}),
  }));
  publishLocalRunEvent(parent, {
    id: `${parent}:delegation:${crypto.randomUUID()}`,
    type: "delegation.updated",
    delegation: { children: shown },
  });
}

/** Holds the call until its children finish or the hold ends, showing their progress as it changes. */
async function awaitChildren(request: LocalToolRequest, entry: RunEntry, callId: string) {
  const deadline = Date.now() + holdMs;
  let last = "";
  for (;;) {
    const all = await Promise.all((await childrenOf(entry.account, entry.runId)).map(refresh));
    await saveChildren(entry.account, entry.runId, all).catch(() => undefined);
    const signature = all.map((child) => `${child.runId}:${child.state}`).join(",");
    if (signature !== last) {
      last = signature;
      publishChildren(entry.runId, all);
    }
    const children = callId ? all.filter((child) => child.callId === callId) : all;
    const running = children.filter((child) => !finished(child.state)).length;
    if (!running || Date.now() > deadline || request.signal.aborted)
      return resultOf(children, running);
    await waitForChange(children, request.signal);
  }
}

/** Until a child ends or the next look is due, whichever is first. */
function waitForChange(children: Child[], signal: AbortSignal) {
  return new Promise<void>((done) => {
    const stops: (() => void)[] = [];
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      stops.forEach((stop) => stop());
      done();
    };
    const timer = setTimeout(finish, checkMs);
    signal.addEventListener("abort", finish, { once: true });
    for (const child of children)
      stops.push(
        followLocalRunEvents(child.runId, (event) => {
          if (event.type.startsWith("invocation.")) finish();
        }),
      );
  });
}

async function entryOf(request: LocalToolRequest): Promise<RunEntry> {
  const entry = await loadRunEntry(request.runId);
  if (!entry)
    throw new LocalToolRejected(
      "run_context_unknown",
      "This computer has no record of what this run may use, so nothing was done.",
    );
  return entry;
}

const delegate: LocalToolHandler = async (request) => {
  const entry = await entryOf(request);
  // Sub-agents never start sub-agents of their own.
  if (entry.parentRunId) throw invalid("Sub-agents can't start sub-agents.");
  const { tasks, browser } = parseTasks(request.input);
  const callId = request.callId.trim();
  if (!callId || callId.length > 200) throw invalid("The tool arguments are invalid.");
  const existing = (await childrenOf(entry.account, entry.runId)).filter(
    (child) => child.callId === callId,
  );
  // A retried call waits for the children it already started.
  if (!existing.length) {
    const tabs = browser
      ? await spawnTabs(
          request,
          entry,
          tasks.map((task) => viewLabel(task.goal)),
        )
      : [];
    const started: Child[] = [];
    for (const [index, task] of tasks.entries()) {
      started.push({
        callId,
        taskIndex: index,
        goal: task.goal,
        outputSchema: task.output_schema,
        runId: await startChild(entry, callId, index, task, tabs[index]),
        state: "running",
        answer: "",
        error: "",
      });
    }
    await saveChildren(entry.account, entry.runId, [
      ...(await childrenOf(entry.account, entry.runId)),
      ...started,
    ]);
  }
  return awaitChildren(request, entry, callId);
};

const wait: LocalToolHandler = async (request) => {
  const entry = await entryOf(request);
  if (!(await childrenOf(entry.account, entry.runId)).length)
    throw invalid("this task has no sub-agents; start them with agent_delegate");
  return awaitChildren(request, entry, "");
};

export const delegationTools: Record<string, LocalToolHandler> = {
  "agent.delegate": delegate,
  "agent.wait": wait,
};

/** Stops a parent's sub-agents still running, when the parent is stopped or finishes without them. */
export async function cancelSubAgentsOf(parent: string, account?: string): Promise<void> {
  const owner = account ?? (await loadRunEntry(parent))?.account;
  if (!owner) return;
  const children = await childrenOf(owner, parent);
  await Promise.allSettled(
    children
      .filter((child) => !finished(child.state))
      .map((child) => invoke("agent_run_cancel", { runId: child.runId })),
  );
}
