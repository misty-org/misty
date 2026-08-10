import type {
  FileSyncApplyResult,
  FileSyncCompareRow,
  FileSyncEndpoint,
  FileSyncPair,
} from "@/native/contracts";
import type { FileSyncPlannedAction, FileSyncPolicy } from "@/native/contracts/primitives";

export interface FileSyncSession {
  activePairId: number | null;
  pairName: string;
  left: FileSyncEndpoint;
  right: FileSyncEndpoint;
  rows: FileSyncCompareRow[];
  comparedAtMs: number;
  stale: boolean;
  watchMode: boolean;
  comparing: boolean;
  applying: boolean;
  error: string | null;
  message: string | null;
}

export interface FileSyncStore {
  pairs: FileSyncPair[];
  loadingPairs: boolean;
  pairsLoaded: boolean;
  pairError: string | null;
  sessions: Record<string, FileSyncSession>;
  loadPairs: () => Promise<void>;
  ensureSession: (sessionId: string, left: FileSyncEndpoint, right: FileSyncEndpoint) => void;
  removeSession: (sessionId: string) => void;
  swapRoots: (sessionId: string) => void;
  selectPair: (sessionId: string, pairId: number) => void;
  setPairName: (sessionId: string, name: string) => void;
  savePair: (sessionId: string, policy?: FileSyncPolicy) => Promise<void>;
  removeActivePair: (sessionId: string) => Promise<void>;
  setWatchMode: (sessionId: string, enabled: boolean) => Promise<void>;
  compare: (sessionId: string) => Promise<void>;
  setRowAction: (sessionId: string, relativePath: string, action: FileSyncPlannedAction) => void;
  apply: (sessionId: string) => Promise<FileSyncApplyResult | null>;
}
