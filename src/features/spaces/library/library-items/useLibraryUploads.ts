import { spacesApi } from "../../api/api";
import { nameOfPath, uploadProjectFile } from "../../apps/file-picker/chosenFiles";
import type { LibraryUploadJob, SpaceLibraryData } from "../hook-signatures/useSpaceLibraryData";

const UPLOAD_CONCURRENCY = 2;

/** A file to add: one the system's dialog handed over (`picked`), or one in a project folder. */
export type LibraryUploadSource = { path: string; from: "picked" | "project" };

/** Uploads files into the Library, two at a time, reporting per-file progress. */
export function useLibraryUploads(data: SpaceLibraryData, reload: () => Promise<void>) {
  const { spaceId, canUploadLibrary, setUploadJobs, setLocalError } = data;

  const uploadFiles = async (sources: LibraryUploadSource[]) => {
    if (!canUploadLibrary || sources.length === 0) return;
    setLocalError("");

    const jobs = sources.map(
      ({ path, from }, index): LibraryUploadJob => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
        path,
        ...(from === "project" ? { from } : {}),
        name: nameOfPath(path),
        stage: "queued",
        progress: 0,
      }),
    );
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
          const options = {
            onStage: (stage: LibraryUploadJob["stage"]) =>
              updateJob(job.id, { stage, progress: stage === "finalizing" ? 1 : 0 }),
            onProgress: (progress: number) => updateJob(job.id, { progress }),
          };
          if (job.from === "project") await uploadProjectFile(spaceId, job.path, options);
          else await spacesApi.uploadLibraryPath(spaceId, job.path, "library", options);
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
