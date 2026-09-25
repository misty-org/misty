import { useCallback, useSyncExternalStore } from "react";
import type { createSdkCodeRuntime } from "../sdkCodeRuntime";
import { createCodeExplorer } from "./createCodeExplorer";
import type { CodeExplorerServices } from "./codeExplorerServices";
import { transferSdkCodeEntry } from "../sdkCodeProject";
import { dockLeaves } from "@/features/workspace/dockTree";
import type { CodeWorkspaceStore } from "../codeWorkspaceServices";

/** The picker is supplied by the enclosing app; all project access uses the SDK. */
export function createSdkCodeExplorer(
  runtime: ReturnType<typeof createSdkCodeRuntime>,
  ui: Pick<CodeExplorerServices, "ErrorActivity" | "FolderPicker"> & { workspace?: CodeWorkspaceStore },
) {
  const retarget = (root: string, from: string, to: string) => {
    const replace = (value: unknown): unknown => {
      if (typeof value === "string") return value === from || value.startsWith(`${from}/`) ? to + value.slice(from.length) : value;
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,replace(item)]));
      return value;
    };
    const workspace = ui.workspace?.getState();
    for (const tab of workspace ? dockLeaves(workspace.layout.root).flatMap(p => p.tabs) : []) {
      const next = replace(tab.state);
      if (JSON.stringify(next) !== JSON.stringify(tab.state)) workspace!.updateTabState(tab.id, next);
    }
    runtime.retargetPath(root, from, to);
  };
  const projectFor = (path: string) => runtime.project(path.split("/").slice(0, 3).join("/"));
  async function create(path: string, kind: "file" | "directory") {
    const project = projectFor(path);
    // Validate the complete path before creating any intermediate directories.
    if (!path.startsWith(`${project.root}/`))
      throw new Error("Choose an entry inside the project.");
    const names = path.slice(project.root.length + 1).split("/");
    if (names.some((name) => !name || name === "." || name === ".." || name.includes("\0")))
      throw new Error("Invalid project entry name.");
    let parent = project.root;
    for (const name of names.slice(0, -1)) {
      const matches = (await project.list(parent)).filter((entry) => entry.name === name);
      if (!matches.length) await project.create(`${parent}/${name}`, "directory");
      else if (matches.length !== 1 || matches[0].kind !== "directory")
        throw new Error("An entry in this path is not a project folder.");
      parent = `${parent}/${name}`;
    }
    await project.create(path, kind);
  }
  const renamePath = async (from: string, to: string) => {
    const parent = from.slice(0, from.lastIndexOf("/") + 1);
    if (to.slice(0, to.lastIndexOf("/") + 1) !== parent)
      throw new Error("Rename requires an entry in the same folder.");
    if (from !== to) {
      const project = projectFor(from);
      runtime.preparePathChange(project.root, from);
      await project.rename(from, to.slice(parent.length));
      retarget(project.root, from, to);
    }
  };
  return createCodeExplorer({
    ...ui,
    store: runtime.store,
    pasteItems: async ({ sources, destinationDirectory, operation }) => {
      const destination = projectFor(destinationDirectory);
      const paths = [...new Set(sources.map(({ path }) => path))];
      const roots = paths.filter(
        (path) => !paths.some((parent) => parent !== path && path.startsWith(`${parent}/`)),
      );
      // Resolve every owner before starting a batch; entries cannot cross app mounts.
      const items = roots.map((path) => ({ path, project: projectFor(path) }));
      for (const { path, project } of items) {
        if (operation === "move") {
          if (project.root !== destination.root && Object.keys(runtime.store.getState().projectBuffers[project.root] ?? {}).some(file => file === path || file.startsWith(`${path}/`)))
            throw new Error("Close this project’s open files before moving them to another project.");
          runtime.preparePathChange(project.root, path);
        }
        await transferSdkCodeEntry(project, destination, path, destinationDirectory, operation);
        if (operation === "move" && project.root === destination.root)
          retarget(project.root, path, `${destinationDirectory}/${path.slice(path.lastIndexOf("/")+1)}`);
      }
    },
    rootName: (root) => (runtime.hasProject(root) ? runtime.project(root).name : "Project"),
    useRevision: (root) =>
      useSyncExternalStore(
        useCallback(
          (listener) =>
            runtime.hasProject(root) ? runtime.subscribeProject(root, listener) : () => undefined,
          [root],
        ),
        useCallback(() => (runtime.hasProject(root) ? runtime.projectRevision(root) : 0), [root]),
      ),
    listDirectory: async (path) => ({
      entries: (await projectFor(path).list(path)).map((entry) => ({
        id: entry.path,
        path: entry.path,
        name: entry.name,
        kind: entry.kind === "directory" ? "folder" : "file",
      })),
    }),
    createFile: async (path, contents = "") => {
      await create(path, "file");
      if (contents) await projectFor(path).writeText(path, contents);
    },
    createFolder: (path) => create(path, "directory"),
    renamePath,
    deletePath: (path) => projectFor(path).remove(path, { recursive: true }),
    deleteItems: async ({ paths }) => {
      for (const path of paths) await projectFor(path).remove(path, { recursive: true });
    },
    renameItems: async ({ items }) => {
      for (const item of items)
        await renamePath(
          item.path,
          `${item.path.slice(0, item.path.lastIndexOf("/") + 1)}${item.newName}`,
        );
    },
  });
}
