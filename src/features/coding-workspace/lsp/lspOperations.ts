import type { Text } from "@codemirror/state";

export interface Position {
  line: number;
  character: number;
}
export interface LspRange {
  start: Position;
  end: Position;
}
export interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
}
export interface TextEdit {
  range: LspRange;
  newText: string;
}
export interface LspLocation {
  uri: string;
  range: LspRange;
}
export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: Array<{
    textDocument?: { uri: string; version?: number | null };
    edits?: TextEdit[];
  }>;
}
export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind?: number;
  range: LspRange;
  selectionRange?: LspRange;
  children?: DocumentSymbol[];
}
export interface LspCodeAction {
  title: string;
  kind?: string;
  edit?: WorkspaceEdit;
  command?: { title: string; command: string; arguments?: unknown[] };
}

export function offsetToPosition(doc: Text, offset: number): Position {
  const clamped = Math.min(Math.max(0, offset), doc.length);
  const line = doc.lineAt(clamped);
  return { line: line.number - 1, character: clamped - line.from };
}

export function positionToOffset(doc: Text, position: Position): number {
  const lineNumber = Math.min(Math.max(1, position.line + 1), doc.lines);
  const line = doc.line(lineNumber);
  return Math.min(line.to, line.from + Math.max(0, position.character));
}
