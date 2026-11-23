import { notify } from "@misty/ui";
import { filesApi } from "@/features/agents";
import {
  disk,
  needsConfirm,
  type Failure,
  type FinderTag,
  type Resolution,
} from "@/features/files";
import { driveNative } from "../drive";
import type { FilesDialogs } from "./dialogs/UseFilesDialogs";
import { copyIntoDrive } from "./drive_copy";
import { countText, messageOf } from "./format";
import { createIn } from "./list_folder";
import {
  childOf,
  localPath,
  nameOf,
  parentOf,
  placeFolder,
  placeInside,
  type FileItem,
  type FilesPlace,
} from "./model";
import { bySource, sourceOf, type FileSourceAdapter } from "./sources";
import { diskSource } from "./sources/disk_source";
import type { BrowserStore } from "./store/browser_store";
import type { Run } from "./use_operations";

export interface ActionDeps {
  store: BrowserStore;
  granted: boolean;
  run: Run;
  ask(): FilesDialogs | null;
  openDrive(item: FileItem): void;
  changed(): void;
  pick?(items: FileItem[]): void;
}

export const fail = (cause: unknown, fallback: string) =>
  notify({ message: messageOf(cause, fallback), tone: "error" });

const failures = (failed: Failure[], verb: string) => {
  if (!failed.length) return;
  notify({
    message:
      failed.length === 1
        ? `${nameOf(failed[0].path) || "An item"} couldn't ${verb}: ${failed[0].error}`
        : `${countText(failed.length)} couldn't ${verb}.`,
    tone: "error",
  });
};

const existing = (cause: unknown) => {
  const message = messageOf(cause, "");
  return message.startsWith("exists:") ? message.slice("exists:".length) || "an item" : null;
};

const pathsOf = (items: FileItem[]) => items.flatMap((item) => localPath(item) ?? []);
const titleFor = (items: FileItem[]) =>
  items.length === 1 ? `“${items[0].name}”` : countText(items.length);

export const canPasteIn = (place: FilesPlace, granted: boolean) =>
  Boolean(placeFolder(place)) && (granted || place.kind === "project");

export const canCreateIn = (place: FilesPlace, granted: boolean) =>
  canPasteIn(place, granted) || place.kind === "space-drive";

export function createFileActions(deps: ActionDeps) {
  const { store, granted } = deps;
  const here = () => store.getState().place;
  const select = (ids: string[]) => store.getState().select(ids);
  const ask = () => {
    const dialogs = deps.ask();
    if (!dialogs) throw new Error("Files isn't open.");
    return dialogs;
  };
  const adapterFor = (item: FileItem): FileSourceAdapter =>
    granted && item.source.kind === "project" ? diskSource : sourceOf(item);

  const guard = async (work: () => Promise<unknown>, fallback: string) => {
    try {
      await work();
    } catch (cause) {
      fail(cause, fallback);
    } finally {
      deps.changed();
    }
  };

  const opened = (item: FileItem, attempt: (confirmed: boolean) => Promise<void>) =>
    void attempt(false).catch((cause: unknown) => {
      if (!needsConfirm(cause)) return fail(cause, `${item.name} couldn't open.`);
      void ask().confirm({
        title: `Open “${item.name}”?`,
        what: "It's an app or script that can run on this Mac.",
        confirmLabel: "Open",
        onConfirm: () => attempt(true),
      });
    });

  const transfer = async (op: "copy" | "move", sources: string[], dir: string) => {
    const moving = sources.filter((source) => !(op === "move" && parentOf(source) === dir));
    if (!moving.length) return;
    if (!granted) {
      for (const source of moving)
        await filesApi.paste(source, dir).catch((cause) => fail(cause, "Couldn't paste."));
      return deps.changed();
    }
    try {
      const conflicts = await disk.conflicts(moving, dir);
      let resolutions: Record<string, Resolution> = {};
      if (conflicts.length) {
        const answers = await ask().conflicts(conflicts, op);
        if (!answers) return;
        resolutions = answers;
      }
      const result = await deps.run(
        op === "copy" ? "Copying" : "Moving",
        (opId) => disk.transfer(op, moving, dir, resolutions, opId),
        {
          from: moving.length === 1 ? moving[0] : parentOf(moving[0]),
          to: dir,
          items: moving.length,
        },
      );
      failures(result.failed, op === "copy" ? "be copied" : "be moved");
      if (dir === placeFolder(here())) select(result.created);
    } catch (cause) {
      fail(cause, op === "copy" ? "Couldn't copy." : "Couldn't move.");
    } finally {
      deps.changed();
    }
  };

  const moveInDrive = async (spaceId: string, paths: string[], folder: string) => {
    const done = async (replace: boolean) => {
      const moved = await driveNative.move(spaceId, paths, folder, replace);
      if (moved.length < paths.length)
        notify({
          message: `${countText(paths.length - moved.length)} couldn't be moved.`,
          tone: "error",
        });
      deps.changed();
    };
    try {
      await done(false);
    } catch (cause) {
      const name = existing(cause);
      if (!name) return fail(cause, "Couldn't move it.");
      void ask().confirm({
        title: `Replace “${name}”?`,
        what: "The one already in that folder moves to the Trash.",
        confirmLabel: "Replace",
        onConfirm: () => done(true),
      });
    }
  };

  const actions = {
    transfer,

    open(item: FileItem) {
      const inside = placeInside(item, here());
      if (inside) return store.getState().go(inside);
      if (deps.pick) return deps.pick([item]);
      const source = item.source;
      if (source.kind === "drive") return deps.openDrive(item);
      if (source.kind === "disk") {
        const path = source.entry.path;
        return opened(item, async (confirmed) => {
          await disk.open([path], confirmed);
          void disk.noteRecent(path).catch(() => undefined);
        });
      }
      if (source.kind === "project") store.getState().setQuick(item);
    },

    openWith(item: FileItem, app: string) {
      const path = localPath(item);
      if (path) opened(item, (confirmed) => disk.openWith(path, app, confirmed));
    },

    rename(item: FileItem) {
      const adapter = adapterFor(item);
      if (!adapter.canRename || !adapter.rename) return;
      const rename = adapter.rename;
      ask().name({
        title: `Rename ${item.folder ? "folder" : "file"}`,
        initial: item.name,
        onConfirm: async (name) => {
          if (name === item.name) return;
          const done = async (replace: boolean) => {
            const renamed = await rename(item, name, replace);
            deps.changed();
            select([renamed]);
          };
          try {
            await done(false);
          } catch (cause) {
            const taken = existing(cause);
            if (!taken) throw cause;
            void ask().confirm({
              title: `Replace “${taken}”?`,
              what: "The one already in this folder moves to the Trash.",
              confirmLabel: "Replace",
              onConfirm: () => done(true),
            });
          }
        },
      });
    },

    create(kind: "folder" | "file") {
      const place = here();
      if (!canCreateIn(place, granted)) return;
      ask().name({
        title: kind === "folder" ? "New folder" : "New file",
        initial: kind === "folder" ? "untitled folder" : "untitled.txt",
        confirmLabel: "Create",
        onConfirm: async (name) => {
          const made = await createIn(place, kind, name, granted);
          deps.changed();
          select([made]);
        },
      });
    },

    duplicate(items: FileItem[]) {
      const paths = pathsOf(items);
      void guard(async () => {
        const made = granted
          ? await disk.duplicate(paths)
          : await Promise.all(paths.map(async (path) => (await filesApi.duplicate(path)).path));
        select(made);
      }, "Couldn't duplicate.");
    },

    compress(items: FileItem[]) {
      const paths = pathsOf(items);
      if (!paths.length) return;
      const where = {
        from: paths.length === 1 ? paths[0] : parentOf(paths[0]),
        to: parentOf(paths[0]),
        items: paths.length,
      };
      void guard(
        async () =>
          select([await deps.run("Compressing", (opId) => disk.compress(paths, opId), where)]),
        "Couldn't zip.",
      );
    },

    extract(item: FileItem) {
      const path = localPath(item);
      if (path)
        void guard(
          async () =>
            select([
              await deps.run("Expanding", (opId) => disk.extract(path, opId), {
                from: path,
                to: parentOf(path),
                items: 1,
              }),
            ]),
          "Couldn't expand.",
        );
    },

    makeAlias(item: FileItem) {
      const path = localPath(item);
      if (path)
        void guard(async () => select([await disk.makeLink(path)]), "Couldn't make an alias.");
    },

    tag(items: FileItem[], tag: FinderTag, on: boolean) {
      void guard(
        () =>
          Promise.all(
            items.flatMap((item) => {
              const path = localPath(item);
              if (!path) return [];
              const rest = item.tags.filter((other) => other.name !== tag.name);
              return [disk.setTags([path], on ? [...rest, tag] : rest)];
            }),
          ),
        "Couldn't change the tags.",
      );
    },

    star(items: FileItem[], on: boolean) {
      void guard(() => disk.star(pathsOf(items), on), on ? "Couldn't star." : "Couldn't unstar.");
    },

    clip(items: FileItem[], cut: boolean) {
      const paths = pathsOf(items);
      if (!paths.length) return;
      store.getState().setCut(cut ? items.map((item) => item.id) : []);
      const done = granted ? disk.copyToClipboard(paths, cut) : filesApi.clipboardSetFiles(paths);
      void done.catch((cause) => fail(cause, "Couldn't copy."));
    },

    async paste() {
      const folder = placeFolder(here());
      if (!folder || !canPasteIn(here(), granted)) return;
      if (!granted) {
        await filesApi.pasteClipboard(folder).then(
          (result) => {
            select(result.created.map((made) => made.path));
            if (result.failed.length)
              notify({
                message: `${countText(result.failed.length)} couldn't be pasted.`,
                tone: "error",
              });
          },
          (cause) => fail(cause, "Couldn't paste."),
        );
        return deps.changed();
      }
      const clip = await disk.clipboard().catch(() => null);
      if (clip?.paths.length) await transfer(clip.cut ? "move" : "copy", clip.paths, folder);
      if (clip?.cut) store.getState().setCut([]);
    },

    copyPath(items: FileItem[]) {
      const pathOf = (item: FileItem) =>
        localPath(item) ?? (item.source.kind === "drive" ? item.source.entry.path : item.name);
      void navigator.clipboard
        .writeText(items.map(pathOf).join("\n"))
        .catch((cause) => fail(cause, "Couldn't copy the path."));
    },

    reveal(item: FileItem) {
      void adapterFor(item)
        .reveal?.(item)
        .catch((cause) => fail(cause, "Couldn't show it."));
    },

    async trash(items: FileItem[]) {
      await guard(async () => {
        const failed: Failure[] = [];
        const groups = new Map<FileSourceAdapter, FileItem[]>();
        for (const item of items) {
          const adapter = adapterFor(item);
          if (adapter.canTrash) groups.set(adapter, [...(groups.get(adapter) ?? []), item]);
        }
        for (const [adapter, group] of groups)
          if (adapter.trash) failed.push(...(await adapter.trash(group)));
        failures(failed, "be moved to the Trash");
      }, "Couldn't move it to the Trash.");
    },

    deleteNow(items: FileItem[]) {
      const paths = pathsOf(items);
      if (!paths.length || !granted) return;
      void ask().confirm({
        title: `Delete ${titleFor(items)} immediately?`,
        what: "It skips the Trash. You can't undo this.",
        onConfirm: async () => {
          try {
            const failed = await deps.run("Deleting", (opId) => disk.deleteNow(paths, opId), {
              from: paths.length === 1 ? paths[0] : parentOf(paths[0]),
              items: paths.length,
            });
            if (failed.length) throw new Error(failed[0].error);
          } finally {
            deps.changed();
          }
        },
      });
    },

    putBack(items: FileItem[]) {
      void guard(async () => {
        const failed: Failure[] = [];
        for (const [adapter, group] of bySource(items))
          if (adapter.restore) failed.push(...(await adapter.restore(group)));
        failures(failed, "be put back");
      }, "Couldn't put it back.");
    },

    deleteFromTrash(items: FileItem[]) {
      void ask().confirm({
        title: `Delete ${titleFor(items)}?`,
        what: "It is deleted for good. You can't undo this.",
        onConfirm: async () => {
          try {
            const failed: Failure[] = [];
            for (const [adapter, group] of bySource(items))
              if (adapter.purge) failed.push(...(await adapter.purge(group)));
            if (failed.length) throw new Error(failed[0].error);
          } finally {
            deps.changed();
          }
        },
      });
    },

    emptyAgentTrash() {
      void ask().confirm({
        title: "Empty agent trash?",
        what: "Everything agents moved there is deleted for good. You can't undo this.",
        confirmLabel: "Empty",
        onConfirm: async () => {
          const failed = await disk.agentTrashEmpty().finally(deps.changed);
          if (failed.length) throw new Error(failed[0].error);
        },
      });
    },

    async drop(
      items: FileItem[],
      target: { dir: string } | { spaceId: string; path: string },
      copy: boolean,
    ) {
      if (!("dir" in target)) {
        const moving = items.flatMap((item) =>
          item.source.kind === "drive" &&
          item.source.entry.space_id === target.spaceId &&
          parentOf(item.source.entry.path) !== target.path &&
          item.source.entry.path !== target.path
            ? [item.source.entry.path]
            : [],
        );
        if (moving.length) await moveInDrive(target.spaceId, moving, target.path);
      }
      const paths = pathsOf(items);
      if (!paths.length) return;
      if ("dir" in target) return transfer(copy ? "copy" : "move", paths, target.dir);
      await guard(
        () =>
          deps.run("Copying", () => copyIntoDrive(target.spaceId, target.path, items), {
            from: paths.length === 1 ? paths[0] : parentOf(paths[0]),
            to: target.path,
            items: items.length,
            stoppable: false,
          }),
        "Couldn't copy it into the Space.",
      );
    },

    dropInto(folder: FilesPlace, dropped: FileItem[], copy: boolean) {
      if (folder.kind === "disk" || folder.kind === "project")
        void actions.drop(dropped, { dir: folder.path }, copy);
      else if (folder.kind === "space-drive")
        void actions.drop(dropped, { spaceId: folder.spaceId, path: folder.path }, copy);
    },

    batchRename(items: FileItem[]) {
      ask().batchRename(pathsOf(items), (created) => {
        deps.changed();
        select(created);
      });
    },

    compare(items: FileItem[]) {
      const [left, right] = pathsOf(items);
      if (left && right) ask().compare(left, right);
    },

    duplicates(dir: string) {
      ask().duplicates(dir);
    },

    goToFolder(home: string | undefined) {
      if (!granted) return;
      ask().name({
        title: "Go to folder",
        initial: placeFolder(here()) ?? home ?? "",
        confirmLabel: "Go",
        fieldLabel: "Folder",
        onConfirm: async (typed) => {
          const path =
            typed === "~"
              ? home
              : typed.startsWith("~/") && home
                ? childOf(home, typed.slice(2))
                : typed;
          if (!path) throw new Error("Write the folder's full path.");
          const info = await disk.info(path).catch(() => null);
          if (!info) throw new Error("There's no folder there.");
          if (info.entry.kind !== "folder") throw new Error(`${info.entry.name} isn't a folder.`);
          store.getState().go({ kind: "disk", path: info.entry.path });
        },
      });
    },
  };
  return actions;
}

export type FileActions = ReturnType<typeof createFileActions>;
