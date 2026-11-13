import { create } from "zustand";
import { aiSurfaceApi } from "./api";
import { aiPaneSession, aiSessionKey } from "./invocationSessions";
import { artifactActions } from "./storeArtifacts";
import { patchSession } from "./storeRuntime";
import type {
  AiArtifact,
  AiCaptureAttachment,
  AiTranscriptMessage,
  AiInvocationState,
  AiSurfaceAdapter,
  AiSuggestedAction,
  MistyApprovalPrompt,
  MistyUndoReceipt,
} from "./invocationTypes";
import { openMisty } from "../../conversations/ask/handoff";
import { mistyContextRef } from "../../conversations/context/context";

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

/** The pane whose change waits on approval, and the last change that can be undone. */
interface MistyCompanionSession {
  accountId?: string;
  paneId?: string;
  approval?: MistyApprovalPrompt;
  undo?: MistyUndoReceipt;
}

export interface AiSurfaceState {
  sessions: Record<string, AiPaneSession>;
  registrations: Record<string, AiPaneRegistration>;
  companion: MistyCompanionSession;
  registerPane: (registration: AiPaneRegistration) => () => void;
  updatePaneAdapter: (accountId: string, paneId: string, adapter: AiSurfaceAdapter) => void;
  summon: (accountId: string, paneId: string) => void;
  returnHome: () => void;
  dismiss: () => void;
  setPrompt: (accountId: string, paneId: string, prompt: string) => void;
  setCapture: (accountId: string, paneId: string, capture?: AiCaptureAttachment) => void;
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
  companion: {},

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

  summon: (accountId, paneId) => {
    const registration = get().registrations[aiSessionKey(accountId, paneId)];
    if (!registration) return;
    void get().submit(accountId, paneId, registration.adapter);
  },
  returnHome: () => {
    const current = get().companion;
    if (current.accountId && current.paneId) {
      const session = aiPaneSession(get().sessions, current.accountId, current.paneId);
      const inFlight = session.state === "queued" || session.state === "running";
      patchSession(set, get, current.accountId, current.paneId, {
        interactionOpen: inFlight || Boolean(current.approval),
      });
    }
    set({
      companion: {
        accountId: current.accountId,
        paneId: current.paneId,
        approval: current.approval,
        undo: current.undo,
      },
    });
  },
  dismiss: () => get().returnHome(),
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
  },

  ...artifactActions(set, get),
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
      registrations: Object.fromEntries(
        Object.entries(state.registrations).filter(([, value]) => value.accountId !== accountId),
      ),
      companion: state.companion.accountId === accountId ? {} : state.companion,
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
      companion: {},
    });
  }
}
