import {
  createEditorEphemeralStore,
  EMPTY_DIAGNOSTICS,
  type CursorInfo,
  type DiagnosticsInfo,
} from "./createEditorEphemeralStore";
export * from "./createEditorEphemeralStore";
export const useEditorEphemeralStore = createEditorEphemeralStore();

export function useGroupCursor(groupId: string): CursorInfo | null {
  return useEditorEphemeralStore((state) => state.cursors[groupId] ?? null);
}

export function useGroupDiagnostics(groupId: string): DiagnosticsInfo {
  return useEditorEphemeralStore((state) => state.diagnostics[groupId] ?? EMPTY_DIAGNOSTICS);
}
