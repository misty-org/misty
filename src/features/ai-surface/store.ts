import { analytics } from "@/telemetry/client";
import { create } from "zustand";
import { aiSurfaceApi } from "./api";
import { aiPaneSession, aiSessionKey } from "./storeHelpers";
import { artifactActions } from "./storeArtifacts";
import { clearSpeechTimer, makeSpeech, patchSession } from "./storeRuntime";
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

interface AiPaneRegistration {
  accountId: string;
  paneId: string;
  adapter: AiSurfaceAdapter;
  element: HTMLElement;
}

interface MistyCompanionSession {
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

  summon: (accountId, paneId, _anchor) => {
    const registration = get().registrations[aiSessionKey(accountId, paneId)];
    if (!registration) return;
    void get().submit(accountId, paneId, registration.adapter);
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
    const { openMisty } = await import("@/features/misty/handoff");
    const { mistyContextRef } = await import("@/features/misty/context");
    await openMisty({
      accountId,
      paneId,
      surfaceId: adapter.surfaceId,
      prompt: action?.prompt ?? current.prompt,
      context: adapter.getContext().map(mistyContextRef),
      selection: adapter.getSelection?.() ?? undefined,
      requestedArtifactKind: action?.requestedArtifactKind,
    });
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

  ...artifactActions(set, get),
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

export function resetAiSurfaceAccountState(accountId?: string): void {
  if (accountId) {
    useAiSurfaceStore.getState().clearAccount(accountId);
  } else {
    for (const [, stop] of streamStops) {
      stop();
    }
    streamStops.clear();
    useAiSurfaceStore.setState({
      sessions: {},
      registrations: {},
      companion: { phase: "home", completedCount: 0 },
    });
  }
}
