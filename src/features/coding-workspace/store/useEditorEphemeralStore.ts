import { create } from "zustand";

export interface CursorInfo {
  line: number;
  column: number;
}

export interface DiagnosticsInfo {
  errors: number;
  warnings: number;
}

export interface ProjectDiagnostic {
  path: string;
  fromLine: number;
  fromCharacter: number;
  toLine: number;
  toCharacter: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
}

interface EphemeralState {
  cursors: Record<string, CursorInfo | null>;
  diagnostics: Record<string, DiagnosticsInfo>;
  projectDiagnostics: Record<string, Record<string, ProjectDiagnostic[]>>;
  symbolContexts: Record<string, string | null>;
  setCursor: (groupId: string, cursor: CursorInfo | null) => void;
  setDiagnostics: (groupId: string, diagnostics: DiagnosticsInfo) => void;
  setProjectDiagnostics: (rootPath: string, path: string, diagnostics: ProjectDiagnostic[]) => void;
  setSymbolContext: (groupId: string, symbol: string | null) => void;
  clearGroup: (groupId: string) => void;
}

const EMPTY_DIAGNOSTICS: DiagnosticsInfo = { errors: 0, warnings: 0 };

export const useEditorEphemeralStore = create<EphemeralState>((set) => ({
  cursors: {},
  diagnostics: {},
  projectDiagnostics: {},
  symbolContexts: {},
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
  setProjectDiagnostics: (rootPath, path, diagnostics) =>
    set((state) => ({
      projectDiagnostics: {
        ...state.projectDiagnostics,
        [rootPath]: { ...(state.projectDiagnostics[rootPath] ?? {}), [path]: diagnostics },
      },
    })),
  setSymbolContext: (groupId, symbol) =>
    set((state) =>
      state.symbolContexts[groupId] === symbol
        ? state
        : {
            symbolContexts: { ...state.symbolContexts, [groupId]: symbol },
          },
    ),
  clearGroup: (groupId) =>
    set((state) => {
      const cursors = { ...state.cursors };
      const diagnostics = { ...state.diagnostics };
      const symbolContexts = { ...state.symbolContexts };
      delete cursors[groupId];
      delete diagnostics[groupId];
      delete symbolContexts[groupId];
      return { cursors, diagnostics, symbolContexts };
    }),
}));

export function useGroupCursor(groupId: string): CursorInfo | null {
  return useEditorEphemeralStore((state) => state.cursors[groupId] ?? null);
}

export function useGroupDiagnostics(groupId: string): DiagnosticsInfo {
  return useEditorEphemeralStore((state) => state.diagnostics[groupId] ?? EMPTY_DIAGNOSTICS);
}
