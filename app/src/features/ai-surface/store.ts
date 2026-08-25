import { analytics } from "@/telemetry/client";
import { create } from "zustand";
import { aiSurfaceApi, subscribeToAiInvocation } from "./api";
import { aiMessage, aiPaneSession, aiSessionKey } from "./storeHelpers";
import {
  clearSpeechTimer,
  conciseSpeech,
  consumeInvocationEvent,
  failInvocation,
  makeSpeech,
  patchArtifact,
  patchSession,
  pointerAnchor,
  scheduleHome,
} from "./storeRuntime";
import type {
  AiArtifact,
  AiCaptureAttachment,
  AiCompanionAnchor,
  AiTranscriptMessage,
  AiInvocationState,
  AiSurfaceAdapter,
  AiSuggestedAction,
  MistyApprovalPrompt,
  MistyPresencePhase,
  MistySpeech,
  MistyUndoReceipt,
} from "./types";

export interface AiPaneSession {
  accountId: string;
  paneId: string;
  prompt: string;
  conversationId?: string;
  invocationId?: string;
  runId?: string;
  state: AiInvocationState | "idle";
  error?: string;
  messages: AiTranscriptMessage[];
  contextBoundary?: string;
  activeTaskId?: string;
  interactionOpen?: boolean;
  capture?: AiCaptureAttachment;
}

export interface AiPaneRegistration {
  accountId: string;
  paneId: string;
  adapter: AiSurfaceAdapter;
  element: HTMLElement;
}

export interface MistyCompanionSession {
  phase: MistyPresencePhase;
  accountId?: string;
  paneId?: string;
  anchor?: AiCompanionAnchor;
  speech?: MistySpeech;
  approval?: MistyApprovalPrompt;
  undo?: MistyUndoReceipt;
  completedCount: number;
}

export interface AiSurfaceState {
  sessions: Record<string, AiPaneSession>;
  registrations: Record<string, AiPaneRegistration>;
  companion: MistyCompanionSession;
  registerPane: (registration: AiPaneRegistration) => () => void;
  updatePaneAdapter: (accountId: string, paneId: string, adapter: AiSurfaceAdapter) => void;
  follow: (accountId: string, paneId: string, anchor?: AiCompanionAnchor) => void;
  summon: (accountId: string, paneId: string, anchor?: AiCompanionAnchor) => void;
  returnHome: () => void;
  dismiss: () => void;
  setPrompt: (accountId: string, paneId: string, prompt: string) => void;
  setCapture: (accountId: string, paneId: string, capture?: AiCaptureAttachment) => void;
  settle: () => void;
  setContextBoundary: (accountId: string, paneId: string, boundary: string) => void;
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
  undoLast: () => Promise<void>;
  clearAccount: (accountId: string) => void;
}

const streamStops = new Map<string, () => void>();
const undoCallbacks = new Map<string, () => void | Promise<void>>();

export const useAiSurfaceStore = create<AiSurfaceState>((set, get) => ({
  sessions: {},
  registrations: {},
  companion: { phase: "home", completedCount: 0 },

  registerPane: (registration) => {
    const key = aiSessionKey(registration.accountId, registration.paneId);
    set((state) => ({ registrations: { ...state.registrations, [key]: registration } }));
    return () => {
      if (get().registrations[key]?.element !== registration.element) return;
      set((state) => {
        const registrations = { ...state.registrations };
        delete registrations[key];
        return { registrations };
      });
    };
  },

  updatePaneAdapter: (accountId, paneId, adapter) => {
    const key = aiSessionKey(accountId, paneId);
    const current = get().registrations[key];
    if (!current || current.adapter === adapter) return;
    set((state) => ({
      registrations: {
        ...state.registrations,
        [key]: { ...current, adapter },
      },
    }));
  },

  follow: (accountId, paneId, anchor) => {
    const key = aiSessionKey(accountId, paneId);
    const registration = get().registrations[key] ?? Object.values(get().registrations)[0];
    const resolvedAccountId = accountId || registration?.accountId || "";
    const resolvedPaneId = paneId || registration?.paneId || "";
    get().summon(resolvedAccountId, resolvedPaneId, anchor);
    set((state) => ({
      companion: {
        ...state.companion,
        phase: "following",
        accountId: resolvedAccountId || state.companion.accountId,
        paneId: resolvedPaneId || state.companion.paneId,
      },
    }));
  },

  summon: (accountId, paneId, anchor) => {
    const key = aiSessionKey(accountId, paneId);
    const registration = get().registrations[key] ?? Object.values(get().registrations)[0];
    clearSpeechTimer(accountId);
    const current = aiPaneSession(get().sessions, accountId, paneId);
    const companion = get().companion;
    const recalling =
      companion.completedCount > 0 &&
      Boolean(companion.speech) &&
      (!companion.accountId || companion.accountId === accountId);
    const session =
      current.interactionOpen || recalling
        ? current
        : {
            ...current,
            conversationId: undefined,
            invocationId: undefined,
            activeTaskId: undefined,
            messages: [],
            error: undefined,
            interactionOpen: true,
          };
    set((state) => ({
      sessions: { ...state.sessions, [key]: session },
      companion: {
        phase: state.companion.approval
          ? "awaiting_approval"
          : recalling
            ? "speaking"
            : "composing",
        accountId,
        paneId,
        anchor: pointerAnchor(paneId, anchor, registration.element),
        speech: state.companion.speech,
        completedCount: Math.max(0, state.companion.completedCount - 1),
      },
    }));
    if (recalling) {
      analytics.track("ai_companion_reply_recalled", { surface: registration.adapter.surfaceId });
    }
    analytics.track("ai_companion_summoned", {
      surface: registration.adapter.surfaceId,
      anchor_kind: "pointer",
    });
  },

  returnHome: () => {
    const current = get().companion;
    const registration =
      current.accountId && current.paneId
        ? get().registrations[aiSessionKey(current.accountId, current.paneId)]
        : undefined;
    if (current.accountId && current.paneId) {
      const session = aiPaneSession(get().sessions, current.accountId, current.paneId);
      const inFlight = session.state === "queued" || session.state === "running";
      patchSession(set, get, current.accountId, current.paneId, {
        interactionOpen: inFlight || Boolean(current.approval),
      });
    }
    clearSpeechTimer(current.accountId);
    set({
      companion: {
        phase: "home",
        accountId: current.accountId,
        paneId: current.paneId,
        speech: current.speech,
        approval: current.approval,
        undo: current.undo,
        completedCount: current.completedCount,
      },
    });
    if (registration) {
      analytics.track("ai_companion_dismissed", {
        surface: registration.adapter.surfaceId,
        had_task: Boolean(current.speech || current.approval),
      });
    }
  },
  dismiss: () => get().returnHome(),
  settle: () => {
    const current = get().companion;
    if (current.phase === "home" || !current.accountId || !current.paneId) return;
    set({
      companion: {
        ...current,
        phase: "following",
        speech: undefined,
        approval: undefined,
      },
    });
  },
  setPrompt: (accountId, paneId, prompt) =>
    patchSession(set, get, accountId, paneId, { prompt, error: undefined }),
  setCapture: (accountId, paneId, capture) =>
    patchSession(set, get, accountId, paneId, { capture }),

  setContextBoundary: (accountId, paneId, boundary) => {
    const current = aiPaneSession(get().sessions, accountId, paneId);
    if (current.contextBoundary === boundary) return;
    const crossed = Boolean(current.contextBoundary) && current.contextBoundary !== boundary;
    patchSession(set, get, accountId, paneId, {
      contextBoundary: boundary,
      ...(crossed
        ? {
            conversationId: undefined,
            invocationId: undefined,
            activeTaskId: undefined,
            interactionOpen: false,
            messages: [],
            prompt: "",
          }
        : {}),
    });
  },

  submit: async (accountId, paneId, adapter, action) => {
    const current = aiPaneSession(get().sessions, accountId, paneId);
    const prompt = (action?.prompt ?? current.prompt).trim();
    if (!prompt || current.state === "queued" || current.state === "running") return;
    const key = aiSessionKey(accountId, paneId);
    const taskId = current.activeTaskId ?? crypto.randomUUID();
    patchSession(set, get, accountId, paneId, {
      prompt: "",
      state: "queued",
      error: undefined,
      activeTaskId: taskId,
      interactionOpen: true,
      messages: [...current.messages, aiMessage("user", prompt, taskId)],
    });
    set((state) => ({
      companion: {
        ...state.companion,
        phase: "working",
        speech: makeSpeech("status", "Getting started…", true),
        approval: undefined,
      },
    }));
    analytics.track("ai_companion_task_submitted", {
      surface: adapter.surfaceId,
      trigger: action?.trigger ?? (adapter.getSelection?.() ? "selection" : "message"),
      refinement: false,
    });
    try {
      const created = await aiSurfaceApi.createInvocation({
        mode: "companion",
        surfaceId: adapter.surfaceId,
        trigger: action?.trigger ?? (adapter.getSelection?.() ? "selection" : "message"),
        prompt,
        context: adapter.getContext(),
        selection: adapter.getSelection?.() ?? undefined,
        capture: current.capture,
        requestedArtifactKind: action?.requestedArtifactKind,
        conversationId: current.conversationId,
        idempotencyKey: crypto.randomUUID(),
      });
      patchSession(set, get, accountId, paneId, {
        capture: undefined,
        invocationId: created.invocationId,
        conversationId: created.conversationId ?? current.conversationId,
        state: created.state,
      });
      streamStops.get(key)?.();
      streamStops.set(
        key,
        subscribeToAiInvocation(created.eventsUrl, {
          onEvent: (event) => consumeInvocationEvent(set, get, accountId, paneId, adapter, event),
          onError: (error) => failInvocation(set, get, accountId, paneId, error.message),
        }),
      );
    } catch (error) {
      failInvocation(
        set,
        get,
        accountId,
        paneId,
        error instanceof Error ? error.message : "Misty could not start this task.",
      );
    }
  },

  cancel: async (accountId, paneId) => {
    const current = aiPaneSession(get().sessions, accountId, paneId);
    if (!current.invocationId) return;
    await aiSurfaceApi.cancelInvocation(current.invocationId).catch(() => undefined);
    streamStops.get(aiSessionKey(accountId, paneId))?.();
    patchSession(set, get, accountId, paneId, { state: "canceled" });
    set((state) => ({
      companion: {
        ...state.companion,
        phase: "speaking",
        speech: makeSpeech("reply", "Stopped."),
      },
    }));
  },

  decideArtifact: async (accountId, paneId, adapter, artifact, decision) => {
    analytics.track("ai_companion_artifact_decided", {
      surface: adapter.surfaceId,
      artifact_kind: artifact.kind,
      decision,
    });
    if (decision === "refine") {
      set((state) => ({
        companion: {
          ...state.companion,
          phase: "composing",
          approval: undefined,
          speech: makeSpeech(
            "clarification",
            `What should I change about ${artifact.title}?`,
            true,
          ),
        },
      }));
      return;
    }
    patchArtifact(set, get, accountId, paneId, artifact.id, {
      state: decision === "accept" ? "applying" : "rejected",
    });
    if (decision === "reject") {
      set((state) => ({
        companion: {
          ...state.companion,
          phase: "speaking",
          approval: undefined,
          speech: makeSpeech("reply", "Canceled."),
        },
      }));
      scheduleHome(get, accountId);
      return;
    }
    try {
      const response = await aiSurfaceApi.decideArtifact(
        artifact.id,
        "accept",
        artifact.idempotencyKey,
        artifact.kind === "task_set" ? artifact.operations : undefined,
      );
      if (response.applyMode === "client") {
        if (!adapter.applyArtifact || adapter.canApply?.(artifact) === false) {
          throw new Error("The source changed. Ask Misty to regenerate this change.");
        }
        const clearHighlight = adapter.highlightArtifactTarget?.(artifact);
        await adapter.applyArtifact(artifact);
        if (typeof clearHighlight === "function") window.setTimeout(clearHighlight, 1_500);
        await aiSurfaceApi.completeArtifact(artifact.id, "applied");
      }
      await adapter.onArtifactApplied?.(response.artifact ?? artifact, response.result);
      analytics.track("ai_companion_direct_effect", {
        surface: adapter.surfaceId,
        artifact_kind: artifact.kind,
      });
      patchArtifact(set, get, accountId, paneId, artifact.id, { state: "applied" });
      let undo: MistyUndoReceipt | undefined;
      if (adapter.undoArtifact) {
        undo = {
          id: crypto.randomUUID(),
          artifactId: artifact.id,
          title: `Undo ${artifact.title.toLowerCase()}`,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        };
        undoCallbacks.set(undo.id, () => adapter.undoArtifact!(artifact));
      }
      set((state) => ({
        companion: {
          ...state.companion,
          phase: state.companion.phase === "home" ? "home" : "speaking",
          approval: undefined,
          undo,
          speech: makeSpeech("reply", artifact.summary || "Done."),
          completedCount:
            state.companion.phase === "home"
              ? state.companion.completedCount + 1
              : state.companion.completedCount,
        },
      }));
      scheduleHome(get, accountId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "That change could not be applied.";
      patchArtifact(set, get, accountId, paneId, artifact.id, {
        state: message.includes("changed") ? "stale" : "failed",
        error: message,
      });
      void aiSurfaceApi.completeArtifact(artifact.id, "failed", message).catch(() => undefined);
      failInvocation(set, get, accountId, paneId, message);
    }
  },

  undoLast: async () => {
    const receipt = get().companion.undo;
    if (!receipt || Date.parse(receipt.expiresAt) < Date.now()) return;
    await undoCallbacks.get(receipt.id)?.();
    const current = get().companion;
    const registration =
      current.accountId && current.paneId
        ? get().registrations[aiSessionKey(current.accountId, current.paneId)]
        : undefined;
    if (registration)
      analytics.track("ai_companion_undo", { surface: registration.adapter.surfaceId });
    undoCallbacks.delete(receipt.id);
    set((state) => ({
      companion: {
        ...state.companion,
        undo: undefined,
        speech: makeSpeech("reply", "Undone."),
        phase: "speaking",
      },
    }));
    scheduleHome(get, get().companion.accountId);
  },

  clearAccount: (accountId) => {
    for (const [key, stop] of streamStops) {
      if (!key.startsWith(`${accountId}:`)) continue;
      stop();
      streamStops.delete(key);
    }
    clearSpeechTimer(accountId);
    set((state) => ({
      sessions: Object.fromEntries(
        Object.entries(state.sessions).filter(([, value]) => value.accountId !== accountId),
      ),
      registrations: Object.fromEntries(
        Object.entries(state.registrations).filter(([, value]) => value.accountId !== accountId),
      ),
      companion:
        state.companion.accountId === accountId
          ? { phase: "home", completedCount: 0 }
          : state.companion,
    }));
  },
}));

export const testingAiPaneSession = aiPaneSession;
export const testingConciseSpeech = conciseSpeech;
