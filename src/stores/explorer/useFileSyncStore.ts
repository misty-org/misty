import type { SetFileSyncState } from "@/models/types/stores/explorer/useFileSyncStore";
export type { SetFileSyncState } from "@/models/types/stores/explorer/useFileSyncStore";
import type {
  FileSyncSession,
  FileSyncStore,
} from "@/models/interfaces/stores/explorer/useFileSyncStore";
export type {
  FileSyncSession,
  FileSyncStore,
} from "@/models/interfaces/stores/explorer/useFileSyncStore";
import { create } from "zustand";
import {
  fileSyncApply,
  fileSyncCompare,
  fileSyncPairRemove,
  fileSyncPairSave,
  fileSyncPairsSnapshot,
} from "@/stores/backend";
import type { FileSyncPlannedAction, FileSyncPolicy } from "@/models/types/services/misty-api";
import type {
  FileSyncApplyResult,
  FileSyncCompareRow,
  FileSyncEndpoint,
  FileSyncPair,
} from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";

export const useFileSyncStore = create<FileSyncStore>((set, get) => ({
  pairs: [],
  loadingPairs: false,
  pairsLoaded: false,
  pairError: null,
  sessions: {},

  loadPairs: async () => {
    if (get().loadingPairs || get().pairsLoaded) return;
    set({ loadingPairs: true, pairError: null });
    try {
      set({ pairs: await fileSyncPairsSnapshot(), pairsLoaded: true });
    } catch (error) {
      set({ pairError: errorText(error) });
    } finally {
      set({ loadingPairs: false });
    }
  },

  ensureSession: (sessionId, left, right) =>
    set((state) => {
      const existing = state.sessions[sessionId];
      if (existing && endpointsEqual(existing.left, left) && endpointsEqual(existing.right, right))
        return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: existing
            ? { ...existing, left, right, rows: [], stale: true, comparedAtMs: 0 }
            : createSession(left, right),
        },
      };
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[sessionId];
      return { sessions };
    }),

  swapRoots: (sessionId) =>
    updateSession(set, sessionId, (session) => ({
      ...session,
      left: session.right,
      right: session.left,
      rows: [],
      stale: true,
    })),

  selectPair: (sessionId, activePairId) => {
    const pair = get().pairs.find((candidate) => candidate.id === activePairId);
    if (!pair) return;
    updateSession(set, sessionId, () => ({
      ...createSession(pair.left, pair.right),
      activePairId,
      pairName: pair.name,
      watchMode: pair.watchMode,
      stale: true,
      comparedAtMs: pair.lastComparedAtMs,
    }));
  },

  setPairName: (sessionId, pairName) =>
    updateSession(set, sessionId, (session) => ({ ...session, pairName })),

  savePair: async (sessionId, preferredPolicy = "bi_directional") => {
    const session = get().sessions[sessionId];
    if (!session) return;
    clearSessionNotice(set, sessionId);
    try {
      const saved = await fileSyncPairSave(pairFromSession(session, preferredPolicy));
      set((state) => ({
        pairs: state.pairs.some((pair) => pair.id === saved.id)
          ? state.pairs.map((pair) => (pair.id === saved.id ? saved : pair))
          : [...state.pairs, saved],
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...state.sessions[sessionId],
            activePairId: saved.id,
            pairName: saved.name,
            message: "Sync pair saved.",
          },
        },
      }));
    } catch (error) {
      setSessionError(set, sessionId, error);
    }
  },

  removeActivePair: async (sessionId) => {
    const pairId = get().sessions[sessionId]?.activePairId;
    if (pairId == null) return;
    try {
      await fileSyncPairRemove(pairId);
      set((state) => ({
        pairs: state.pairs.filter((pair) => pair.id !== pairId),
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...state.sessions[sessionId],
            activePairId: null,
            pairName: "",
            message: "Sync pair removed.",
          },
        },
      }));
    } catch (error) {
      setSessionError(set, sessionId, error);
    }
  },

  setWatchMode: async (sessionId, watchMode) => {
    updateSession(set, sessionId, (session) => ({ ...session, watchMode }));
    const session = get().sessions[sessionId];
    const pair = get().pairs.find((candidate) => candidate.id === session?.activePairId);
    if (!pair) {
      if (watchMode) await get().savePair(sessionId);
      return;
    }
    try {
      const saved = await fileSyncPairSave({ ...pair, watchMode });
      set((state) => ({
        pairs: state.pairs.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
      }));
    } catch (error) {
      setSessionError(set, sessionId, error);
    }
  },

  compare: async (sessionId) => {
    const session = get().sessions[sessionId];
    if (!session || session.comparing) return;
    updateSession(set, sessionId, (value) => ({
      ...value,
      comparing: true,
      error: null,
      message: null,
    }));
    try {
      const result = await fileSyncCompare({
        left: session.left,
        right: session.right,
        pairId: session.activePairId ?? undefined,
      });
      if (!result.success) throw new Error(result.errorMessage || "Compare failed.");
      updateSession(set, sessionId, (value) => ({
        ...value,
        rows: result.rows,
        comparedAtMs: result.comparedAtMs,
        stale: false,
      }));
    } catch (error) {
      setSessionError(set, sessionId, error);
    } finally {
      updateSession(set, sessionId, (value) => ({ ...value, comparing: false }));
    }
  },

  setRowAction: (sessionId, relativePath, action) =>
    updateSession(set, sessionId, (session) => ({
      ...session,
      rows: session.rows.map((row) =>
        row.relativePath === relativePath ? { ...row, action } : row,
      ),
      stale: true,
    })),

  apply: async (sessionId) => {
    const session = get().sessions[sessionId];
    if (!session || session.applying) return null;
    updateSession(set, sessionId, (value) => ({
      ...value,
      applying: true,
      error: null,
      message: null,
    }));
    try {
      const result = await fileSyncApply({
        left: session.left,
        right: session.right,
        rows: session.rows,
        pairId: session.activePairId ?? undefined,
      });
      updateSession(set, sessionId, (value) => ({
        ...value,
        stale: false,
        message: `Queued ${result.appliedCount} sync ${result.appliedCount === 1 ? "action" : "actions"}.`,
      }));
      return result;
    } catch (error) {
      setSessionError(set, sessionId, error);
      return null;
    } finally {
      updateSession(set, sessionId, (value) => ({ ...value, applying: false }));
    }
  },
}));

function updateSession(
  set: SetFileSyncState,
  sessionId: string,
  update: (session: FileSyncSession) => FileSyncSession,
): void {
  set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;
    return { sessions: { ...state.sessions, [sessionId]: update(session) } };
  });
}

function clearSessionNotice(set: SetFileSyncState, sessionId: string): void {
  updateSession(set, sessionId, (session) => ({ ...session, error: null, message: null }));
}

function setSessionError(set: SetFileSyncState, sessionId: string, error: unknown): void {
  updateSession(set, sessionId, (session) => ({ ...session, error: errorText(error) }));
}

function createSession(left: FileSyncEndpoint, right: FileSyncEndpoint): FileSyncSession {
  return {
    activePairId: null,
    pairName: "",
    left,
    right,
    rows: [],
    comparedAtMs: 0,
    stale: true,
    watchMode: false,
    comparing: false,
    applying: false,
    error: null,
    message: null,
  };
}

function pairFromSession(session: FileSyncSession, preferredPolicy: FileSyncPolicy): FileSyncPair {
  return {
    id: session.activePairId ?? 0,
    name:
      session.pairName.trim() ||
      `Pair: ${endpointTitle(session.left)} <-> ${endpointTitle(session.right)}`,
    left: session.left,
    right: session.right,
    watchMode: session.watchMode,
    stale: session.stale,
    preferredPolicy,
    lastComparedAtMs: session.comparedAtMs,
    lastScanAtMs: session.comparedAtMs,
  };
}

function endpointTitle(endpoint: FileSyncEndpoint): string {
  if (endpoint.kind === "local")
    return endpoint.localPath.split("/").filter(Boolean).pop() || endpoint.localPath;
  return `${endpoint.remoteName}:${endpoint.remotePath || "/"}`;
}

function endpointsEqual(left: FileSyncEndpoint, right: FileSyncEndpoint): boolean {
  return (
    left.kind === right.kind &&
    left.localPath === right.localPath &&
    left.remoteName === right.remoteName &&
    left.remotePath === right.remotePath &&
    left.providerType === right.providerType
  );
}
