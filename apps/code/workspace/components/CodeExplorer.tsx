import { MistyFilePicker } from "@/features/picker";
import { SystemErrorActivity } from "@/features/activity";
import {
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  explorerQueueRenameItems,
} from "@/features/files/native";
import {
  codeCreateFile,
  codeCreateFolder,
  codeDeletePath,
  codeListDirectory,
  codeRenamePath,
} from "../native";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { createCodeExplorer } from "./createCodeExplorer";
import { createCodeExplorerRow } from "./createCodeExplorerRow";
import type { CodeExplorerServices } from "./codeExplorerServices";
const services: CodeExplorerServices = {
  store: useCodingWorkspaceStore,
  listDirectory: codeListDirectory,
  createFile: codeCreateFile,
  createFolder: codeCreateFolder,
  renamePath: codeRenamePath,
  deletePath: codeDeletePath,
  deleteItems: explorerQueueDeleteItems,
  pasteItems: explorerQueuePasteItems,
  renameItems: explorerQueueRenameItems,
  ErrorActivity: SystemErrorActivity,
  FolderPicker: (props) => <MistyFilePicker mode="folder" title="Open project folder" {...props} />,
  useRevision: () => 0,
};
export const CodeExplorer = createCodeExplorer(services);
export const CodeExplorerRow = createCodeExplorerRow(services);
