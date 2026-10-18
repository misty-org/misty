import { libraryApi as spacesApi } from "../LibraryRuntime";
import type { LibraryUploadJob, SpaceLibraryData } from "../types/useSpaceLibraryData";

const UPLOAD_CONCURRENCY = 2;

/** Uploads files into the Library, two at a time, reporting per-file progress. */
export function useLibraryUploads(data: SpaceLibraryData, reload: () => Promise<void>) {
  const { spaceId, canUploadLibrary, setUploadJobs, setLocalError } = data;

  const uploadFiles = async (paths: string[]) => {
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

    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          await spacesApi.uploadLibraryPath(spaceId, job.path, "library", {
            onStage: (stage) =>
              updateJob(job.id, { stage, progress: stage === "finalizing" ? 1 : 0 }),
            onProgress: (progress) => updateJob(job.id, { progress }),
          });
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
    await reload();
  };

  return { uploadFiles };
}
