import type { useSpaceLibraryData } from "../useSpaceLibraryData";

export type LibraryCollectionKind = "recent" | "favorites" | "deleted";

export type LibraryUploadJob = {
  id: string;
  path: string;
  name: string;
  stage: "queued" | "reading" | "hashing" | "uploading" | "finalizing" | "ready" | "failed";
  progress: number;
  error?: string;
};

export type SpaceLibraryData = ReturnType<typeof useSpaceLibraryData>;
