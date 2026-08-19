import { create } from "zustand";

export interface CursorInfo {
  line: number;
  column: number;
}

export interface DiagnosticsInfo {
  errors: number;
  warnings: number;
}

interface EphemeralState {
  cursors: Record<string, CursorInfo | null>;
  diagnostics: Record<string, DiagnosticsInfo>;
  setCursor: (groupId: string, cursor: CursorInfo | null) => void;
  setDiagnostics: (groupId: string, diagnostics: DiagnosticsInfo) => void;
  clearGroup: (groupId: string) => void;
}

const EMPTY_DIAGNOSTICS: DiagnosticsInfo = { errors: 0, warnings: 0 };

export const useEditorEphemeralStore = create<EphemeralState>((set) => ({
  cursors: {},
  diagnostics: {},
  setCursor: (groupId, cursor) =>
    set((state) => {
      const existing = state.cursors[groupId];
      if (existing?.line === cursor?.line && existing?.column === cursor?.column) {
        return state;
      }
      return { cursors: { ...state.cursors, [groupId]: cursor } };
    }),
  setDiagnostics: (groupId, diagnostics) =>
    set((state) => {
      const existing = state.diagnostics[groupId];
      if (existing?.errors === diagnostics.errors && existing?.warnings === diagnostics.warnings) {
        return state;
      }
      return { diagnostics: { ...state.diagnostics, [groupId]: diagnostics } };
    }),
  clearGroup: (groupId) =>
    set((state) => {
      const cursors = { ...state.cursors };
      const diagnostics = { ...state.diagnostics };
      delete cursors[groupId];
      delete diagnostics[groupId];
      return { cursors, diagnostics };
    }),
}));

export function useGroupCursor(groupId: string): CursorInfo | null {
  return useEditorEphemeralStore((state) => state.cursors[groupId] ?? null);
}

export function useGroupDiagnostics(groupId: string): DiagnosticsInfo {
  return useEditorEphemeralStore((state) => state.diagnostics[groupId] ?? EMPTY_DIAGNOSTICS);
}
