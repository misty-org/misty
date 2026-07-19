import { create } from "zustand";
import {
  smartLibraryApplyResults,
  smartLibraryAssetsPage,
  smartLibraryDelete,
  smartLibraryImportFiles,
  smartLibraryPreflightImport,
  smartLibraryPreparePreviews,
  smartLibraryScan,
  smartLibrarySetServerFolderId,
  smartLibrarySnapshot,
} from "../api/misty";
import type { AnalysisEstimate, FolderLibraryStatus, SmartLibraryAsset, SmartLibraryImportPreflight } from "../api/types";
import { errorText } from "../shared/format";
import { clearSemanticExplorerSearchCache } from "../pages/Files/utils/globalSearch";
import {
  approveSmartLibraryFolder,
  approveSmartLibrarySample,
  candidatesFromAssets,
  completeSemanticReindex,
  createSmartLibrarySample,
  deleteSmartLibraryFolder,
  fetchSmartLibraryProgress,
  fetchSmartLibraryResults,
  planSemanticReindex,
  registerSmartLibraryFolder,
  submitSmartLibraryPreflight,
  submitSmartLibraryRescan,
  updateSmartLibraryAssetTags,
  type SmartLibraryPreviewInput,
  type SmartLibraryProgress,
  type SemanticReindexInput,
  type SemanticReindexPlan,
} from "./smartLibraryServerApi";

type SmartLibraryPhase = "idle" | "scanning" | "preflight" | "uploading" | "processing" | "reindexing" | "review" | "complete" | "error";

interface SmartLibraryStore {
  loaded: boolean;
  phase: SmartLibraryPhase;
  library: FolderLibraryStatus | null;
  progress: SmartLibraryProgress | null;
  estimate: AnalysisEstimate | null;
  reindexPlan: SemanticReindexPlan | null;
  reindexProcessed: number;
  error: string | null;
  pendingDrop: SmartLibraryImportPreflight | null;
  load: () => Promise<void>;
  chooseFolder: (rootPath: string) => Promise<void>;
  addFiles: (paths: string[]) => Promise<void>;
  requestDroppedFiles: (paths: string[]) => Promise<void>;
  confirmDroppedFiles: () => Promise<void>;
  cancelDroppedFiles: () => void;
  discoverChanges: () => Promise<void>;
  rescan: () => Promise<void>;
  trySample: () => Promise<void>;
  analyzeFolder: () => Promise<void>;
  refreshProgress: () => Promise<void>;
  checkIndexUpgrade: () => Promise<void>;
  upgradeIndex: () => Promise<void>;
  setAssetTags: (assetId: string, tags: string[]) => Promise<void>;
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
  reindexPlan: null,
  reindexProcessed: 0,
  error: null,
  pendingDrop: null,

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
    set({ phase: "scanning", error: null });
    try {
      const library = await smartLibraryScan(rootPath);
      set({ library, phase: "preflight", estimate: library.preflight.estimate, error: null });
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },

  addFiles: async (paths) => {
    const selected = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (selected.length === 0 || get().phase === "uploading" || get().phase === "processing") return;
    set({ phase: "uploading", error: null });
    try {
      const imported = await smartLibraryImportFiles(selected);
      set({ loaded: true, library: imported.library, estimate: imported.library.preflight.estimate });
      const selectedAssets = await loadAssetsByIds(new Set(imported.importedAssetIds));
      const eligible = selectedAssets.filter((asset) => asset.previewSupported && ["pending", "changed", "failed"].includes(asset.status));
      if (eligible.length === 0) {
        set({ phase: phaseFromLibrary(imported.library), error: "The selected files are already analyzed or are not supported for Library analysis." });
        return;
      }

      const folderId = await ensureServerFolder(imported.library);
      if (imported.library.serverFolderId) {
        await submitSmartLibraryRescan(folderId, imported.library.preflight);
      }
      let serverProgress = await fetchSmartLibraryProgress(folderId);
      let sampleIds = new Set(serverProgress.sampleAssetIds ?? []);
      if (sampleIds.size === 0 && serverProgress.successfulImages === 0) {
        const sample = await createSmartLibrarySample(folderId, candidatesFromAssets(eligible.slice(0, 25)));
        sampleIds = new Set(sample.assetIds);
      }
      const included = eligible
        .filter((asset) => sampleIds.has(asset.assetId) && asset.status !== "changed")
        .map((asset) => asset.assetId);
      const billable = eligible
        .filter((asset) => !sampleIds.has(asset.assetId) || asset.status === "changed")
        .map((asset) => asset.assetId);
      if (included.length > 0) serverProgress = await analyzeAssets(folderId, included, "sample");
      if (billable.length > 0) serverProgress = await analyzeAssets(folderId, billable, "full");
      set({ progress: serverProgress, phase: phaseFromProgress(serverProgress), error: serverProgress.message ?? null });
      await get().refreshProgress();
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },

  requestDroppedFiles: async (paths) => {
    const selected = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (selected.length === 0) return;
    set({ phase: "preflight", pendingDrop: null, error: null });
    try {
      const pendingDrop = await smartLibraryPreflightImport(selected);
      set({ pendingDrop, estimate: pendingDrop.estimate, phase: "preflight", error: null });
    } catch (error) {
      set({ phase: "error", pendingDrop: null, error: errorText(error) });
    }
  },

  confirmDroppedFiles: async () => {
    const pending = get().pendingDrop;
    if (!pending) return;
    set({ pendingDrop: null });
    await get().addFiles(pending.paths);
  },

  cancelDroppedFiles: () => {
    set((state) => ({ pendingDrop: null, phase: state.library ? phaseFromLibrary(state.library) : "idle" }));
  },

  discoverChanges: async () => {
    const current = get().library;
    if (!current) return;
    set({ phase: "scanning", error: null });
    try {
      const library = await smartLibraryScan(current.rootPath);
      let estimate = library.preflight.estimate;
      set({ library, estimate, phase: "preflight", error: null });
      if (library.serverFolderId) {
        try {
          estimate = (await submitSmartLibraryRescan(library.serverFolderId, library.preflight)).estimate;
        } catch {
          set({
            library,
            estimate,
            phase: "preflight",
            error: "New files were saved locally. Misty will refresh the account estimate when the server is available.",
          });
          return;
        }
      }
      set({ library, estimate, phase: "preflight", error: null });
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },

  rescan: async () => get().discoverChanges(),

  trySample: async () => {
    const current = get().library;
    if (!current || current.preflight.sampleAssetIds.length === 0) return;
    set({ phase: "uploading", error: null });
    try {
      const folderId = await ensureServerFolder(current);
      const currentAfterRegistration = get().library ?? current;
      const serverProgress = await fetchSmartLibraryProgress(folderId);
      const authoritativeSample = serverProgress.sampleAssetIds?.length
        ? serverProgress.sampleAssetIds
        : currentAfterRegistration.preflight.sampleAssetIds;
      const sampleIds = new Set(authoritativeSample.slice(0, 25));
      const candidates = (await loadAssetsByIds(sampleIds)).filter((asset) => asset.status === "pending" || asset.status === "failed" || asset.status === "changed");
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
      const serverProgress = await fetchSmartLibraryProgress(folderId);
      const sampleIds = new Set(serverProgress.sampleAssetIds ?? latest.preflight.sampleAssetIds);
      const eligible = await loadEligibleAssets(500);
      const includedRetries = eligible.filter((asset) => sampleIds.has(asset.assetId) && asset.status !== "changed").map((asset) => asset.assetId);
      const billableIds = eligible
        .filter((asset) => !sampleIds.has(asset.assetId) || asset.status === "changed")
        .slice(0, Math.max(0, 500 - serverProgress.successfulImages - includedRetries.length))
        .map((asset) => asset.assetId);
      let progress: SmartLibraryProgress | null = null;
      if (includedRetries.length > 0) progress = await analyzeAssets(folderId, includedRetries, "sample");
      if (billableIds.length > 0) progress = await analyzeAssets(folderId, billableIds, "full");
      if (!progress) throw new Error("There are no new or changed files to analyze.");
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

  checkIndexUpgrade: async () => {
    const folderId = get().library?.serverFolderId;
    if (!folderId) return;
    set({ error: null });
    try {
      const reindexPlan = await planSemanticReindex({ folderId, limit: 100 });
      set({ reindexPlan, reindexProcessed: 0 });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  upgradeIndex: async () => {
    const library = get().library;
    const folderId = library?.serverFolderId;
    if (!library || !folderId) return;
    set({ phase: "reindexing", error: null, reindexProcessed: 0 });
    try {
      let plan = get().reindexPlan ?? await planSemanticReindex({ folderId, limit: 100 });
      let processed = 0;
      const seenCursors = new Set<string>();
      while (plan.assets.length > 0) {
        for (let offset = 0; offset < plan.assets.length; offset += 8) {
          const assets = plan.assets.slice(offset, offset + 8);
          const inputs = await prepareSemanticReindexInputs(library, assets);
          await completeSemanticReindex(plan.jobId, inputs);
          processed += inputs.length;
          set({ reindexProcessed: processed });
        }
        if (!plan.nextCursor) break;
        if (seenCursors.has(plan.nextCursor)) throw new Error("Index upgrade stopped because the server returned a repeated page cursor.");
        seenCursors.add(plan.nextCursor);
        plan = await planSemanticReindex({ folderId, cursor: plan.nextCursor, limit: 100, targetVersion: plan.targetVersion });
      }
      set({ reindexPlan: null, reindexProcessed: processed, phase: "complete" });
      await get().refreshProgress();
      clearSemanticExplorerSearchCache();
    } catch (error) {
      set({ phase: "error", error: errorText(error) });
    }
  },

  setAssetTags: async (assetId, tags) => {
    const library = get().library;
    const folderId = library?.serverFolderId;
    if (!library || !folderId) return;
    const normalized = [...new Map(tags.map((tag) => [tag.trim().toLocaleLowerCase(), tag.trim()])).values()]
      .filter(Boolean)
      .slice(0, 24);
    try {
      const response = await updateSmartLibraryAssetTags(folderId, assetId, normalized);
      const snapshot = await smartLibraryApplyResults([response.result]);
      set({ library: snapshot.activeLibrary, error: null });
      clearSemanticExplorerSearchCache();
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
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
      set({ library: snapshot.activeLibrary, progress: null, estimate: null, reindexPlan: null, reindexProcessed: 0, phase: "idle", error: null });
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

async function loadEligibleAssets(limit: number): Promise<SmartLibraryAsset[]> {
  const assets: SmartLibraryAsset[] = [];
  let afterAssetId: string | null = null;
  do {
    const page = await smartLibraryAssetsPage({ afterAssetId, limit: Math.min(500, limit), reindexOnly: true });
    assets.push(...page.assets.filter((asset) => asset.previewSupported && ["pending", "changed", "failed"].includes(asset.status)));
    afterAssetId = page.nextCursor;
  } while (afterAssetId && assets.length < limit);
  return assets.slice(0, limit);
}

async function loadAssetsByIds(assetIds: Set<string>): Promise<SmartLibraryAsset[]> {
  const assets: SmartLibraryAsset[] = [];
  let afterAssetId: string | null = null;
  do {
    const page = await smartLibraryAssetsPage({ afterAssetId, limit: 500 });
    for (const asset of page.assets) if (assetIds.has(asset.assetId)) assets.push(asset);
    afterAssetId = page.nextCursor;
  } while (afterAssetId && assets.length < assetIds.size);
  return assets;
}

async function prepareSemanticReindexInputs(
  library: FolderLibraryStatus,
  planned: SemanticReindexPlan["assets"],
): Promise<SemanticReindexInput[]> {
  const localAssets = new Map(library.assets.map((asset) => [asset.assetId, asset]));
  const preparedIds = planned.map((asset) => asset.assetId);
  const previews = preparedIds.length > 0 ? await smartLibraryPreparePreviews(preparedIds, 512) : [];
  const previewsById = new Map(previews.map((preview) => [preview.assetId, preview]));
  return planned.map((asset) => {
    const local = localAssets.get(asset.assetId);
    const preview = previewsById.get(asset.assetId);
    if (asset.requiresPreview && !preview) throw new Error(`Could not prepare a private preview for ${local?.name ?? asset.assetId}.`);
    return {
      assetId: asset.assetId,
      fingerprint: asset.fingerprint,
      assetKind: asset.assetKind,
      mimeType: asset.requiresPreview ? preview?.mimeType ?? asset.mimeType : asset.mimeType,
      ...(preview ? { base64: bytesToBase64(preview.bytes) } : {}),
      ...(preview?.extractedText || local?.extractedText ? { extractedText: preview?.extractedText ?? local?.extractedText ?? undefined } : {}),
      metadata: { ...(local ? reindexMetadata(local) : {}), ...(preview?.metadata ?? {}) },
      ...(preview ? { truncated: preview.truncated } : {}),
    };
  });
}

function reindexMetadata(asset: SmartLibraryAsset): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (asset.description) metadata.description = asset.description;
  if (asset.tags.length > 0) metadata.tags = asset.tags.join(", ");
  if (asset.collections.length > 0) metadata.collections = asset.collections.join(", ");
  if (asset.generatedMetadata) {
    for (const [key, value] of Object.entries(asset.generatedMetadata)) {
      if (typeof value === "string" && value) metadata[key] = value;
      else if (Array.isArray(value) && value.length > 0) metadata[key] = value.join(", ");
    }
  }
  return metadata;
}

async function analyzeAssets(folderId: string, assetIds: string[], kind: "sample" | "full"): Promise<SmartLibraryProgress> {
  let progress: SmartLibraryProgress | null = null;
  for (let offset = 0; offset < assetIds.length; offset += 8) {
    const ids = assetIds.slice(offset, offset + 8);
    const previews = await smartLibraryPreparePreviews(ids, 512);
    const payload: SmartLibraryPreviewInput[] = previews.map((preview) => ({
      assetId: preview.assetId,
      fingerprint: preview.fingerprint,
      mimeType: preview.mimeType,
      assetKind: preview.assetKind,
      ...(preview.bytes.length > 0 ? { base64: bytesToBase64(preview.bytes) } : {}),
      ...(preview.extractedText ? { extractedText: preview.extractedText } : {}),
      metadata: preview.metadata,
      truncated: preview.truncated,
    }));
    const finalBatch = offset + ids.length >= assetIds.length;
    progress = kind === "sample"
      ? await approveSmartLibrarySample(folderId, payload, finalBatch)
      : await approveSmartLibraryFolder(folderId, payload, finalBatch);
    useSmartLibraryStore.setState({ progress, phase: phaseFromProgress(progress) });
  }
  if (!progress) throw new Error("No eligible Library previews were prepared.");
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
