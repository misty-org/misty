import { create } from "zustand";
import { aiSurfaceApi, subscribeToAiInvocation } from "./api";
import type {
  AiArtifact,
  AiDrawerMessage,
  AiInvocationEvent,
  AiInvocationState,
  AiSurfaceAdapter,
  AiSuggestedAction,
} from "./types";

export interface AiPaneSession {
  accountId: string;
  paneId: string;
  open: boolean;
  prompt: string;
  conversationId?: string;
  invocationId?: string;
  state: AiInvocationState | "idle";
  error?: string;
  messages: AiDrawerMessage[];
  pinnedAgentId?: string;
  contextBoundary?: string;
  refiningArtifact?: AiArtifact;
}

interface AiSurfaceState {
  sessions: Record<string, AiPaneSession>;
  setOpen: (accountId: string, paneId: string, open: boolean) => void;
  setPrompt: (accountId: string, paneId: string, prompt: string) => void;
  setContextBoundary: (accountId: string, paneId: string, boundary: string) => void;
  setPinnedAgent: (accountId: string, surfaceId: string, agentId?: string) => void;
  pinnedAgent: (accountId: string, surfaceId: string) => string | undefined;
  submit: (
    accountId: string,
    paneId: string,
    adapter: AiSurfaceAdapter,
    action?: AiSuggestedAction,
  ) => Promise<void>;
  cancel: (accountId: string, paneId: string) => Promise<void>;
  decideArtifact: (
    accountId: string,
    paneId: string,
    adapter: AiSurfaceAdapter,
    artifact: AiArtifact,
    decision: "accept" | "reject" | "refine",
  ) => Promise<void>;
  clearAccount: (accountId: string) => void;
}

const streamStops = new Map<string, () => void>();
const pinnedAgentKey = "misty:ai-surface:pinned-agent:v1";

export const useAiSurfaceStore = create<AiSurfaceState>((set, get) => ({
  sessions: {},
  setOpen: (accountId, paneId, open) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionKey(accountId, paneId)]: {
          ...session(state.sessions, accountId, paneId),
          open,
        },
      },
    })),
  setPrompt: (accountId, paneId, prompt) =>
    patchSession(set, get, accountId, paneId, { prompt, error: undefined }),
  setContextBoundary: (accountId, paneId, boundary) => {
    const current = session(get().sessions, accountId, paneId);
    if (current.contextBoundary === boundary) return;
    const crossingPrivacyBoundary =
      Boolean(current.contextBoundary) && current.contextBoundary !== boundary;
    if (crossingPrivacyBoundary) {
      streamStops.get(sessionKey(accountId, paneId))?.();
      patchSession(set, get, accountId, paneId, {
        contextBoundary: boundary,
        conversationId: undefined,
        invocationId: undefined,
        state: "idle",
        messages: [],
        prompt: "",
        error: undefined,
      });
      return;
    }
    patchSession(set, get, accountId, paneId, { contextBoundary: boundary });
  },
  setPinnedAgent: (accountId, surfaceId, agentId) => {
    if (readPinnedAgent(accountId, surfaceId) === agentId) return;
    writePinnedAgent(accountId, surfaceId, agentId);
    set((state) => ({ sessions: { ...state.sessions } }));
  },
  pinnedAgent: readPinnedAgent,
  submit: async (accountId, paneId, adapter, action) => {
    const current = session(get().sessions, accountId, paneId);
    const prompt = (action?.prompt ?? current.prompt).trim();
    if (!prompt || current.state === "queued" || current.state === "running") return;
    const key = sessionKey(accountId, paneId);
    const refinement = current.refiningArtifact;
    const userMessage = message(
      "user",
      refinement ? `Request changes to ${refinement.title}: ${prompt}` : prompt,
    );
    patchSession(set, get, accountId, paneId, {
      prompt: "",
      state: "queued",
      error: undefined,
      refiningArtifact: undefined,
      messages: [...current.messages, userMessage],
    });
    try {
      if (refinement) {
        await aiSurfaceApi.decideArtifact(
          refinement.id,
          "refine",
          `${refinement.idempotencyKey}:refine`,
          undefined,
          prompt,
        );
        patchArtifact(set, get, accountId, paneId, refinement.id, { state: "rejected" });
      }
      const created = await aiSurfaceApi.createInvocation({
        mode: "drawer",
        surfaceId: adapter.surfaceId,
        trigger: action?.trigger ?? (adapter.getSelection?.() ? "selection" : "message"),
        prompt: refinement
          ? [
              prompt,
              `Revise this previously proposed ${refinement.kind} artifact. Preserve safe parts and return a complete replacement proposal.`,
              `Previous operations (untrusted draft):\n${JSON.stringify(refinement.operations).slice(0, 20 << 10)}`,
            ].join("\n\n")
          : prompt,
        context: adapter.getContext(),
        selection: adapter.getSelection?.() ?? undefined,
        requestedArtifactKind: refinement?.kind ?? action?.requestedArtifactKind,
        conversationId: current.conversationId,
        agentId: readPinnedAgent(accountId, adapter.surfaceId),
        idempotencyKey: crypto.randomUUID(),
      });
      patchSession(set, get, accountId, paneId, {
        invocationId: created.invocationId,
        conversationId: created.conversationId ?? current.conversationId,
        state: created.state,
      });
      streamStops.get(key)?.();
      streamStops.set(
        key,
        subscribeToAiInvocation(created.eventsUrl, {
          onEvent: (event) => consumeInvocationEvent(set, get, accountId, paneId, event),
          onError: (error) =>
            patchSession(set, get, accountId, paneId, { state: "failed", error: error.message }),
        }),
      );
    } catch (error) {
      patchSession(set, get, accountId, paneId, {
        state: "failed",
        error: error instanceof Error ? error.message : "Misty could not start this request.",
      });
    }
  },
  cancel: async (accountId, paneId) => {
    const current = session(get().sessions, accountId, paneId);
    if (!current.invocationId) return;
    await aiSurfaceApi.cancelInvocation(current.invocationId).catch(() => undefined);
    streamStops.get(sessionKey(accountId, paneId))?.();
    patchSession(set, get, accountId, paneId, { state: "canceled" });
  },
  decideArtifact: async (accountId, paneId, adapter, artifact, decision) => {
    if (decision === "refine") {
      patchSession(set, get, accountId, paneId, {
        prompt: "",
        refiningArtifact: artifact,
        error: undefined,
      });
      return;
    }
    patchArtifact(set, get, accountId, paneId, artifact.id, {
      state: decision === "accept" ? "applying" : "rejected",
    });
    try {
      const response = await aiSurfaceApi.decideArtifact(
        artifact.id,
        decision,
        artifact.idempotencyKey,
        decision === "accept" && artifact.kind === "task_set" ? artifact.operations : undefined,
      );
      if (decision === "reject") return;
      if (response.applyMode === "client") {
        if (!adapter.applyArtifact || adapter.canApply?.(artifact) === false) {
          throw new Error("The source changed. Ask Misty to regenerate this draft.");
        }
        await adapter.applyArtifact(artifact);
        await aiSurfaceApi.completeArtifact(artifact.id, "applied");
      }
      await adapter.onArtifactApplied?.(response.artifact ?? artifact, response.result);
      patchArtifact(set, get, accountId, paneId, artifact.id, { state: "applied" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "This draft could not be applied.";
      patchArtifact(set, get, accountId, paneId, artifact.id, {
        state: message.includes("changed") ? "stale" : "failed",
        error: message,
      });
      void aiSurfaceApi.completeArtifact(artifact.id, "failed", message).catch(() => undefined);
    }
  },
  clearAccount: (accountId) => {
    for (const [key, stop] of streamStops) {
      if (!key.startsWith(`${accountId}:`)) continue;
      stop();
      streamStops.delete(key);
    }
    set((state) => ({
      sessions: Object.fromEntries(
        Object.entries(state.sessions).filter(([, value]) => value.accountId !== accountId),
      ),
    }));
  },
}));

type SetState = Parameters<typeof useAiSurfaceStore.setState>[0] extends (...args: never[]) => never
  ? never
  : (
      partial: Partial<AiSurfaceState> | ((state: AiSurfaceState) => Partial<AiSurfaceState>),
    ) => void;
type GetState = () => AiSurfaceState;

function sessionKey(accountId: string, paneId: string) {
  return `${accountId}:${paneId}`;
}

function session(
  sessions: Record<string, AiPaneSession>,
  accountId: string,
  paneId: string,
): AiPaneSession {
  return (
    sessions[sessionKey(accountId, paneId)] ?? {
      accountId,
      paneId,
      open: false,
      prompt: "",
      state: "idle",
      messages: [],
    }
  );
}

function patchSession(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  patch: Partial<AiPaneSession>,
) {
  const key = sessionKey(accountId, paneId);
  set({
    sessions: {
      ...get().sessions,
      [key]: { ...session(get().sessions, accountId, paneId), ...patch },
    },
  });
}

function message(role: AiDrawerMessage["role"], content = ""): AiDrawerMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    citations: [],
    artifacts: [],
  };
}

function consumeInvocationEvent(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  event: AiInvocationEvent,
) {
  const current = session(get().sessions, accountId, paneId);
  if (event.type === "invocation.started") {
    patchSession(set, get, accountId, paneId, { state: event.state });
    return;
  }
  if (event.type === "invocation.completed" || event.type === "invocation.canceled") {
    patchSession(set, get, accountId, paneId, { state: event.state });
    return;
  }
  if (event.type === "invocation.failed") {
    patchSession(set, get, accountId, paneId, { state: event.state, error: event.error });
    return;
  }
  const messages = [...current.messages];
  let assistant = messages[messages.length - 1];
  if (!assistant || assistant.role !== "assistant") {
    assistant = { ...message("assistant"), invocationId: current.invocationId };
    messages.push(assistant);
  }
  const replacement = { ...assistant };
  if (event.type === "response.delta") replacement.content += event.delta;
  if (event.type === "citation") replacement.citations = [...replacement.citations, event.citation];
  if (event.type === "artifact.proposed")
    replacement.artifacts = [...replacement.artifacts, event.artifact];
  messages[messages.length - 1] = replacement;
  patchSession(set, get, accountId, paneId, { messages, state: "running" });
}

function patchArtifact(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  artifactId: string,
  patch: Partial<AiArtifact>,
) {
  const current = session(get().sessions, accountId, paneId);
  patchSession(set, get, accountId, paneId, {
    messages: current.messages.map((item) => ({
      ...item,
      artifacts: item.artifacts.map((artifact) =>
        artifact.id === artifactId ? { ...artifact, ...patch } : artifact,
      ),
    })),
  });
}

function readPinnedAgent(accountId: string, surfaceId: string): string | undefined {
  try {
    const value = window.localStorage.getItem(`${pinnedAgentKey}:${accountId}:${surfaceId}`);
    return value || undefined;
  } catch {
    return undefined;
  }
}

function writePinnedAgent(accountId: string, surfaceId: string, agentId?: string) {
  try {
    const key = `${pinnedAgentKey}:${accountId}:${surfaceId}`;
    if (agentId) window.localStorage.setItem(key, agentId);
    else window.localStorage.removeItem(key);
  } catch {
    // Pinning is an optional personal preference.
  }
}

export const testingAiPaneSession = session;
