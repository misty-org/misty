import type { useFileSyncStore } from "../../../../store";
import type { FileSyncStore } from "../interfaces/useFileSyncStore";

export type SetFileSyncState = Parameters<typeof useFileSyncStore.setState>[0] extends infer _Never
  ? (partial: (state: FileSyncStore) => Partial<FileSyncStore>) => void
  : never;
