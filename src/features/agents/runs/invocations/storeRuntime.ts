import type { StoreApi } from "zustand";
import { aiPaneSession, aiMessage, aiSessionKey } from "./invocationSessions";
import type { AiPaneSession, AiSurfaceState } from "./store";
import type { AiArtifact, AiInvocationEvent } from "./invocationTypes";

type SetState = StoreApi<AiSurfaceState>["setState"];
type GetState = StoreApi<AiSurfaceState>["getState"];

export function patchSession(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  patch: Partial<AiPaneSession>,
) {
  const key = aiSessionKey(accountId, paneId);
  set({
    sessions: {
      ...get().sessions,
      [key]: { ...aiPaneSession(get().sessions, accountId, paneId), ...patch },
    },
  });
}

export function consumeInvocationEvent(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  event: AiInvocationEvent,
) {
  if (event.type === "invocation.started") {
    patchSession(set, get, accountId, paneId, { state: event.state });
    return;
  }
  if (event.type === "assistant.status") {
    if (event.phase === "awaiting_intervention" || event.phase === "intervention_resume_pending") {
      patchSession(set, get, accountId, paneId, {
        state: event.phase === "awaiting_intervention" ? "awaiting_intervention" : "running",
      });
    }
    return;
  }
  if (event.type === "invocation.failed") {
    failInvocation(set, get, accountId, paneId, event.error);
    return;
  }
  if (event.type === "invocation.canceled") {
    patchSession(set, get, accountId, paneId, { state: event.state });
    return;
  }
  if (event.type === "invocation.completed") {
    patchSession(set, get, accountId, paneId, { state: event.state });
    return;
  }
  if (event.type === "run.started") {
    patchSession(set, get, accountId, paneId, { runId: event.runId });
    return;
  }
  if (event.type === "effect.applied" || event.type === "undo.available") {
    return;
  }
  if (
    event.type === "tool.started" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.detail"
  ) {
    return;
  }

  const current = aiPaneSession(get().sessions, accountId, paneId);
  const messages = [...current.messages];
  let assistant = messages[messages.length - 1];
  if (!assistant || assistant.role !== "assistant") {
    assistant = {
      ...aiMessage("assistant", "", current.activeTaskId),
      invocationId: current.invocationId,
    };
    messages.push(assistant);
  }
  const replacement = { ...assistant };
  if (event.type === "response.delta") replacement.content += event.delta;
  if (event.type === "assistant.message") replacement.content = event.text;
  if (event.type === "citation") replacement.citations = [...replacement.citations, event.citation];
  if (event.type === "artifact.proposed" || event.type === "approval.required")
    replacement.artifacts = [...replacement.artifacts, event.artifact];
  messages[messages.length - 1] = replacement;
  patchSession(set, get, accountId, paneId, { messages, state: "running" });

  if (event.type !== "artifact.proposed" && event.type !== "approval.required") return;
  set((state) => ({
    companion: {
      ...state.companion,
      accountId,
      paneId,
      approval: {
        artifact: event.artifact,
        title: event.artifact.title,
        summary: event.artifact.summary,
        confirmLabel: event.artifact.approvalPolicy === "always_confirm" ? "Confirm" : "Apply",
      },
    },
  }));
}

export function failInvocation(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  message: string,
) {
  patchSession(set, get, accountId, paneId, { state: "failed", error: message });
  set((state) => ({ companion: { ...state.companion, approval: undefined } }));
}

export function patchArtifact(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  artifactId: string,
  patch: Partial<AiArtifact>,
) {
  const current = aiPaneSession(get().sessions, accountId, paneId);
  patchSession(set, get, accountId, paneId, {
    messages: current.messages.map((item) => ({
      ...item,
      artifacts: item.artifacts.map((artifact) =>
        artifact.id === artifactId ? { ...artifact, ...patch } : artifact,
      ),
    })),
  });
}
