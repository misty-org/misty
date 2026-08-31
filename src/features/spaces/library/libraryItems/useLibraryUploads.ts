import { spacesApi } from "@/api/spaces/api";
import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { detectUploadedAssetStacks } from "../SpaceLibraryPrimitives";
import type { LibraryUploadJob, SpaceLibraryData } from "../types/useSpaceLibraryData";

const UPLOAD_CONCURRENCY = 2;

/**
 * Uploads files into the Library, two at a time, reporting per-file progress.
 *
 * Once a batch lands, anything that looks like a Live Photo or RAW pair is
 * grouped automatically — that detection needs the whole batch, so it runs
 * after every file has finished rather than per upload.
 */
export function useLibraryUploads(data: SpaceLibraryData, reload: () => Promise<void>) {
  const { spaceId, canUploadLibrary, setUploadJobs, setLocalError } = data;

  const uploadFiles = async (
    paths: string[],
    importSources: Record<string, LibraryProviderImportSource> = {},
  ) => {
    if (!canUploadLibrary || paths.length === 0) return;
    setLocalError("");

    const jobs = paths.map((path, index): LibraryUploadJob => ({
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
      path,
      name:
        path
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .pop() || "file",
      stage: "queued",
      progress: 0,
    }));
    // Append: starting a second batch while the first is still running must not
    // discard the jobs already in flight.
    setUploadJobs((current) => [...current, ...jobs]);

    const updateJob = (id: string, patch: Partial<LibraryUploadJob>) =>
      setUploadJobs((current) =>
        current.map((job) => (job.id === id ? { ...job, ...patch } : job)),
      );

    const uploaded: SpaceLibraryItem[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          const result = await spacesApi.uploadLibraryPath(spaceId, job.path, "library", {
            onStage: (stage) =>
              updateJob(job.id, { stage, progress: stage === "finalizing" ? 1 : 0 }),
            onProgress: (progress) => updateJob(job.id, { progress }),
          });
          if (result.item) {
            const source = importSources[job.path];
            const item = source
              ? await spacesApi.setLibraryProviderImport(spaceId, result.item.id, source)
              : result.item;
            uploaded.push(item);
          }
          updateJob(job.id, { stage: "ready", progress: 1 });
        } catch (error) {
          updateJob(job.id, {
            stage: "failed",
            error: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, jobs.length) }, () => worker()),
    );
    await Promise.allSettled(
      detectUploadedAssetStacks(uploaded).map((input) =>
        spacesApi.createLibraryAssetStack(spaceId, input),
      ),
    );
    await reload();
  };

  return { uploadFiles };
}

export interface LibraryProviderImportSource {
  provider: string;
  remoteName: string;
  remotePath: string;
  connectionId?: string;
  connectionSource?: "connected_account" | "legacy_cloud";
}
