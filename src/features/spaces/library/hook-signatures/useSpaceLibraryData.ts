import type { useSpaceLibraryData } from "../useSpaceLibraryData";

export type LibraryCollectionKind = "recent" | "deleted";

export type LibraryUploadJob = {
  id: string;
  path: string;
  /** `project`: a file in one of the person's projects, read through the file gate rather than by URL. */
  from?: "project";
  name: string;
  stage: "queued" | "reading" | "hashing" | "uploading" | "finalizing" | "ready" | "failed";
  progress: number;
  error?: string;
};

export type SpaceLibraryData = ReturnType<typeof useSpaceLibraryData>;
