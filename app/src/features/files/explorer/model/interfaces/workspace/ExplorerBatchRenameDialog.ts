import type { BatchRenameCaseMode } from "../../types/workspace/ExplorerBatchRenameDialog";

export interface BatchRenameOptions {
  findText: string;
  replaceText: string;
  prefix: string;
  suffix: string;
  caseMode: BatchRenameCaseMode;
  lockExtensions: boolean;
  sequenceEnabled: boolean;
  sequenceStart: number;
  sequencePad: number;
  manualValues: Record<string, string>;
}
