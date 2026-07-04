import { useMemo } from "react";
import { createJSONStorage } from "zustand/middleware";
import { createCodingWorkspaceStore, type OpenTab } from "./createCodingWorkspaceStore";
export * from "./createCodingWorkspaceStore";

// The embedded host keeps its existing persisted store; SDK mounts create their own.
export const useCodingWorkspaceStore = createCodingWorkspaceStore(
  createJSONStorage(() => localStorage),
);

export function useAllOpenTabs(): OpenTab[] {
  const projectBuffers = useCodingWorkspaceStore((state) => state.projectBuffers);
  return useMemo(
    () => Object.values(projectBuffers).flatMap((buffers) => Object.values(buffers)),
    [projectBuffers],
  );
}

export function useDirtyPaths(): Set<string> {
  const projectBuffers = useCodingWorkspaceStore((state) => state.projectBuffers);
  return useMemo(
    () =>
      new Set(
        Object.values(projectBuffers)
          .flatMap((buffers) => Object.values(buffers))
          .filter((buffer) => buffer.contents !== buffer.savedContents)
          .map((buffer) => buffer.path),
      ),
    [projectBuffers],
  );
}
