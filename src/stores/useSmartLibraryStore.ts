import { create } from "zustand";
import {
  smartLibraryApplyResults,
  smartLibraryDelete,
  smartLibraryPreparePreviews,
  smartLibraryScan,
  smartLibrarySearch,
  smartLibrarySetServerFolderId,
  smartLibrarySnapshot,
} from "../api/misty";
import type { AnalysisEstimate, FolderLibraryStatus, SmartLibraryAsset } from "../api/types";
import { errorText } from "../shared/format";
import {
  approveSmartLibraryFolder,
  approveSmartLibrarySample,
  candidatesFromAssets,
  createSmartLibrarySample,
  deleteSmartLibraryFolder,
  fetchSmartLibraryProgress,
  fetchSmartLibraryResults,
  registerSmartLibraryFolder,
  searchSmartLibrary as searchSmartLibraryServer,
  submitSmartLibraryPreflight,
  submitSmartLibraryRescan,
  type SmartLibraryPreviewInput,
  type SmartLibraryProgress,
} from "./smartLibraryServerApi";

type SmartLibraryPhase = "idle" | "scanning" | "preflight" | "uploading" | "processing" | "review" | "complete" | "error";

interface SmartLibraryStore {
  loaded: boolean;
  phase: SmartLibraryPhase;
  library: FolderLibraryStatus | null;
  progress: SmartLibraryProgress | null;
  estimate: AnalysisEstimate | null;
  searchQuery: string;
  searchResults: SmartLibraryAsset[];
  error: string | null;
  load: () => Promise<void>;
  chooseFolder: (rootPath: string) => Promise<void>;
  rescan: () => Promise<void>;
  trySample: () => Promise<void>;
  analyzeFolder: () => Promise<void>;
  refreshProgress: () => Promise<void>;
  search: (query: string, collection?: string) => Promise<void>;
  removeLibrary: () => Promise<void>;
}

let pollTimer: number | null = null;
let resultSequence = 0;

export const useSmartLibraryStore = create<SmartLibraryStore>((set, get) => ({
  loaded: false,
  phase: "idle",
  library: null,
  progress: null,
  estimate: null,
  searchQuery: "",
  searchResults: [],
  error: null,

  load: async () => {
    if (get().loaded) return;
    try {
      const snapshot = await smartLibrarySnapshot();
      set({ loaded: true, library: snapshot.activeLibrary, phase: snapshot.activeLibrary ? phaseFromLibrary(snapshot.activeLibrary) : "idle", error: null });
      if (snapshot.activeLibrary?.serverFolderId) void get().refreshProgress();
    } catch (error) {
      set({ loaded: true, phase: "error", error: errorText(error) });
    }
  },

  chooseFolder: async (rootPath) => {
    if (!rootPath.trim() || get().phase === "scanning") return;
    set({ phase: "scanning", error: null, searchResults: [] });
    try {
      const library = await smartLibraryScan(rootPath);
      set({ library, phase: "preflight", estimate: library.preflight.estimate, error: null });
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },

  rescan: async () => {
    const current = get().library;
    if (!current) return;
    set({ phase: "scanning", error: null });
    try {
      const library = await smartLibraryScan(current.rootPath);
      let estimate = library.preflight.estimate;
      if (library.serverFolderId) {
        estimate = (await submitSmartLibraryRescan(library.serverFolderId, library.preflight)).estimate;
      }
      set({ library, estimate, phase: "preflight", error: null });
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },

  trySample: async () => {
    const current = get().library;
    if (!current || current.preflight.sampleAssetIds.length === 0) return;
    set({ phase: "uploading", error: null });
    try {
      const folderId = await ensureServerFolder(current);
      const currentAfterRegistration = get().library ?? current;
      const sampleIds = new Set(currentAfterRegistration.preflight.sampleAssetIds.slice(0, 25));
      const candidates = currentAfterRegistration.assets.filter((asset) => sampleIds.has(asset.assetId));
      const sample = await createSmartLibrarySample(folderId, candidatesFromAssets(candidates));
      const requested = sample.assetIds.length > 0 ? sample.assetIds.slice(0, 25) : current.preflight.sampleAssetIds;
      const progress = await analyzeAssets(folderId, requested, "sample");
      set({ progress, estimate: sample.estimate, phase: phaseFromProgress(progress), error: progress.message ?? null });
      await get().refreshProgress();
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },

  analyzeFolder: async () => {
    const current = get().library;
    if (!current) return;
    set({ phase: "uploading", error: null });
    try {
      const folderId = await ensureServerFolder(current);
      const latest = get().library ?? current;
      const analyzed = latest.assets.filter((asset) => asset.status === "analyzed").length;
      const ids = eligibleAssets(latest).slice(0, Math.max(0, 500 - analyzed)).map((asset) => asset.assetId);
      const progress = await analyzeAssets(folderId, ids, "full");
      set({ progress, phase: phaseFromProgress(progress), error: progress.message ?? null });
      await get().refreshProgress();
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },

  refreshProgress: async () => {
    const folderId = get().library?.serverFolderId;
    if (!folderId) return;
    try {
      const [progress, response] = await Promise.all([
        fetchSmartLibraryProgress(folderId),
        fetchSmartLibraryResults(folderId, resultSequence),
      ]);
      resultSequence = response.nextSequence;
      let library = get().library;
      if (response.results.length > 0) {
        library = (await smartLibraryApplyResults(response.results)).activeLibrary;
      }
      const phase = progress.phase === "sample_review" ? "review"
        : progress.phase === "complete" ? "complete"
          : progress.phase === "failed" ? "error" : "processing";
      set({ progress, library, estimate: progress.estimate, phase, error: progress.message ?? null });
      if (phase === "review" || phase === "complete" || phase === "error") stopPolling();
    } catch (error) {
      stopPolling();
      set({ phase: "error", error: errorText(error) });
    }
  },

  search: async (query, collection) => {
    const trimmed = query.trim();
    const library = get().library;
    set({ searchQuery: query, error: null });
    if (!library) { set({ searchResults: [] }); return; }
    try {
      if (library.serverFolderId && trimmed) {
        const response = await searchSmartLibraryServer(library.serverFolderId, trimmed);
        const byId = new Map(library.assets.map((asset) => [asset.assetId, asset]));
        set({ searchResults: response.hits.map((hit) => byId.get(hit.assetId)).filter((asset): asset is SmartLibraryAsset => Boolean(asset)) });
      } else {
        set({ searchResults: await smartLibrarySearch(trimmed, collection) });
      }
    } catch {
      // The device catalog remains useful while offline; semantic ranking returns when connected.
      set({ searchResults: await smartLibrarySearch(trimmed, collection) });
    }
  },

  removeLibrary: async () => {
    const folderId = get().library?.serverFolderId;
    set({ error: null });
    try {
      if (folderId) await deleteSmartLibraryFolder(folderId);
      const snapshot = await smartLibraryDelete();
      stopPolling();
      resultSequence = 0;
      set({ library: snapshot.activeLibrary, progress: null, estimate: null, searchQuery: "", searchResults: [], phase: "idle", error: null });
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },
}));

async function ensureServerFolder(library: FolderLibraryStatus): Promise<string> {
  if (library.serverFolderId) return library.serverFolderId;
  const registration = await registerSmartLibraryFolder({
    clientLibraryId: library.libraryId,
    sourceKind: library.sourceKind,
    pilotLimit: 500,
  });
  await submitSmartLibraryPreflight(registration.folderId, library.preflight);
  const snapshot = await smartLibrarySetServerFolderId(registration.folderId);
  useSmartLibraryStore.setState({ library: snapshot.activeLibrary });
  return registration.folderId;
}

function eligibleAssets(library: FolderLibraryStatus): SmartLibraryAsset[] {
  const eligible = new Set(["pending", "changed", "failed"]);
  return library.assets.filter((asset) => asset.previewSupported && eligible.has(asset.status));
}

async function analyzeAssets(folderId: string, assetIds: string[], kind: "sample" | "full"): Promise<SmartLibraryProgress> {
  let progress: SmartLibraryProgress | null = null;
  for (let offset = 0; offset < assetIds.length; offset += 8) {
    const ids = assetIds.slice(offset, offset + 8);
    const previews = await smartLibraryPreparePreviews(ids, 512);
    const payload: SmartLibraryPreviewInput[] = previews.map((preview) => ({
      assetId: preview.assetId,
      fingerprint: preview.fingerprint,
      mimeType: "image/jpeg",
      base64: bytesToBase64(preview.bytes),
    }));
    const finalBatch = offset + ids.length >= assetIds.length;
    progress = kind === "sample"
      ? await approveSmartLibrarySample(folderId, payload, finalBatch)
      : await approveSmartLibraryFolder(folderId, payload, finalBatch);
    useSmartLibraryStore.setState({ progress, phase: phaseFromProgress(progress) });
  }
  if (!progress) throw new Error("No eligible Smart Library previews were prepared.");
  return progress;
}

function phaseFromLibrary(library: FolderLibraryStatus): SmartLibraryPhase {
  return library.assets.some((asset) => asset.status === "analyzed") ? "review" : "preflight";
}

function phaseFromProgress(progress: SmartLibraryProgress): SmartLibraryPhase {
  if (progress.phase === "sample_review") return "review";
  if (progress.phase === "complete") return "complete";
  if (progress.phase === "failed") return "error";
  return "processing";
}

function bytesToBase64(bytes: number[]): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function startPolling(get: () => SmartLibraryStore): void {
  stopPolling();
  pollTimer = window.setInterval(() => void get().refreshProgress(), 5_000);
}

function stopPolling(): void {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
}
