import { disk } from "@/features/files";
import { agentTrashItem, type FileItem } from "../model";
import type { FileSourceAdapter } from "./source_types";

const idsOf = (items: FileItem[]) =>
  items.flatMap((item) => (item.source.kind === "agent-trash" ? [item.source.item.id] : []));

export const listAgentTrash = async () => (await disk.agentTrash()).map(agentTrashItem);

export const agentTrashSource: FileSourceAdapter = {
  kind: "agent-trash",
  local: false,
  canRename: false,
  canTrash: false,
  inTrash: true,
  restore: async (items) => (await disk.agentTrashPutBack(idsOf(items), "keep-both")).failed,
  purge: (items) => disk.agentTrashDelete(idsOf(items)),
  previewUrl: () => undefined,
};
