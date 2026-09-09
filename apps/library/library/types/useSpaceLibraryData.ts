import type { useSpaceLibraryData } from "../useSpaceLibraryData";

export type LibraryCollectionKind =
  | "recent"
  | "smart"
  | "months"
  | "years"
  | "recent-days"
  | "utility"
  | "collections"
  | "favorites"
  | "hidden"
  | "deleted"
  | "people"
  | "albums"
  | "groups"
  | "memory"
  | "trip"
  | "map"
  | "duplicate"
  | "shared"
  | "imports";

export type LibraryUploadJob = {
  id: string;
  path: string;
  name: string;
  stage: "queued" | "reading" | "hashing" | "uploading" | "finalizing" | "ready" | "failed";
  progress: number;
  error?: string;
};

export type SpaceLibraryData = ReturnType<typeof useSpaceLibraryData>;
