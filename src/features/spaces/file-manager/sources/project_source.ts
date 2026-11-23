import { filesApi, imageFileUrl } from "@/features/agents";
import type { Failure } from "@/features/files";
import { checkName, childOf, parentOf, projectItem, type FileItem } from "../model";
import type { FileSourceAdapter } from "./source_types";

const pathOf = (item: FileItem) => (item.source.kind === "project" ? item.source.path : item.id);

export const projectFolder = {
  list: async (path: string) =>
    (await filesApi.listDir(path)).map((entry) => projectItem(path, entry)),
  create: async (folder: string, kind: "folder" | "file", name: string) => {
    const path = childOf(folder, checkName(name));
    await (kind === "folder" ? filesApi.createDir(path) : filesApi.createFile(path));
    return path;
  },
};

export const projectSource: FileSourceAdapter = {
  kind: "project",
  local: true,
  canRename: true,
  canTrash: true,
  inTrash: false,
  rename: async (item, name) => {
    const from = pathOf(item);
    const to = childOf(parentOf(from), checkName(name));
    await filesApi.rename(from, to);
    return to;
  },
  trash: async (items) => {
    const failed: Failure[] = [];
    for (const item of items)
      await filesApi.trash(pathOf(item)).catch((cause: unknown) =>
        failed.push({
          path: pathOf(item),
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    return failed;
  },
  reveal: (item) => filesApi.reveal(pathOf(item)),
  previewUrl: (item) => imageFileUrl(pathOf(item), item.modifiedMs),
  readHead: async (item, limit) => {
    const read = await filesApi.readFile(pathOf(item));
    const text = read.text ?? "";
    return {
      text: text.length > limit ? text.slice(0, limit) : text,
      truncated: read.truncated || text.length > limit,
      binary: read.kind !== "text",
    };
  },
};
