import { getLspClient } from "./useLsp";
import { useEditorEphemeralStore } from "../store/useEditorEphemeralStore";
import { createCodeMirrorLsp } from "./createCodeMirrorLsp";
export * from "./lspOperations";

export const {
  documentVersion,
  goToDefinition,
  showSymbolInformation,
  formatDocument,
  findReferences,
  findReferencesAt,
  renameSymbol,
  documentSymbols,
  codeActions,
  executeLspCommand,
  lspExtension,
} = createCodeMirrorLsp({ getLspClient, editorStore: useEditorEphemeralStore, events: window });
