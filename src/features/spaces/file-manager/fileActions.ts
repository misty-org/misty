import { notify } from "@misty/ui";
import { filesApi } from "@/features/agents";
import { disk, type FinderTag, type Resolution } from "@/features/files";
import { driveNative } from "../drive";
import type { FilesDialogs } from "./dialogs/useFilesDialogs";
import { copyIntoDrive } from "./driveCopy";
import { countText, messageOf } from "./format";
import { childOf, localPath, nameOf, parentOf, placeFolder, placeInside, type FileItem, type FilesPlace } from "./model";
import type { TransferWhere } from "./transfers";

type Run = <T>(label: string, work: (opId: string) => Promise<T>, where?: TransferWhere) => Promise<T>;

export interface ActionContext {
  place: FilesPlace;
  granted: boolean;
  /** After Files changed something: the listing, the undo state and the sidebar's lists read again. */
  changed(): void;
  run: Run;
  ask: FilesDialogs;
  select(ids: string[]): void;
  go(place: FilesPlace): void;
  quickLook(item: FileItem): void;
  /** Opens a drive file: in the app it opens in, or Quick Look. */
  openDrive(item: FileItem): void;
  /** In picking mode, a file opened is a file picked. */
  pick?(items: FileItem[]): void;
}

export const fail = (cause: unknown, fallback: string) =>
  notify({ message: messageOf(cause, fallback), tone: "error" });

const failures = (failed: { path: string; error: string }[], verb: string) => {
  if (!failed.length) return;
  notify({
    message:
      failed.length === 1
        ? `${nameOf(failed[0].path)} couldn't ${verb}: ${failed[0].error}`
        : `${countText(failed.length)} couldn't ${verb}.`,
    tone: "error",
  });
};

const pathsOf = (items: FileItem[]) => items.flatMap((item) => localPath(item) ?? []);
const titleFor = (items: FileItem[]) => (items.length === 1 ? `“${items[0].name}”` : countText(items.length));

/** Every command Files' bar, menus, keys and drops run, on the items they are given. */
export function createFileActions(ctx: ActionContext) {
  const { place, granted } = ctx;
  const folder = placeFolder(place);
  const project = place.kind === "project";

  const guard = async (work: () => Promise<unknown>, fallback: string) => {
    try {
      await work();
    } catch (cause) {
      fail(cause, fallback);
    } finally {
      ctx.changed();
    }
  };

  /** Copies or moves into a folder on the disk, asking about names already there first. */
  const transfer = async (op: "copy" | "move", sources: string[], dir: string) => {
    const moving = sources.filter((source) => !(op === "move" && parentOf(source) === dir));
    if (!moving.length) return;
    if (!granted) {
      // Without the disk grant, a project's own paste copies (`project_paste`), one item at a time.
      for (const source of moving) await filesApi.paste(source, dir).catch((cause) => fail(cause, "Couldn't paste."));
      return ctx.changed();
    }
    try {
      const conflicts = await disk.conflicts(moving, dir);
      let resolutions: Record<string, Resolution> = {};
      if (conflicts.length) {
        const answers = await ctx.ask.conflicts(conflicts, op);
        if (!answers) return;
        resolutions = answers;
      }
      const result = await ctx.run(
        op === "copy" ? "Copying" : "Moving",
        (opId) => disk.transfer(op, moving, dir, resolutions, opId),
        { from: moving.length === 1 ? moving[0] : parentOf(moving[0]), to: dir, items: moving.length },
      );
      failures(result.failed, op === "copy" ? "be copied" : "be moved");
      if (dir === folder) ctx.select(result.created);
    } catch (cause) {
      fail(cause, op === "copy" ? "Couldn't copy." : "Couldn't move.");
    } finally {
      ctx.changed();
    }
  };

  const actions = {
    transfer,

    open(item: FileItem) {
      const inside = placeInside(item, place);
      if (inside) return ctx.go(inside);
      if (ctx.pick) return ctx.pick([item]);
      const source = item.source;
      if (source.kind === "drive") return ctx.openDrive(item);
      if (source.kind === "disk") {
        void disk.open([source.entry.path]).then(
          () => void disk.noteRecent(source.entry.path).catch(() => undefined),
          (cause) => fail(cause, `${item.name} couldn't open.`),
        );
        return;
      }
      // A project's file opens in Quick Look: without the disk grant there is no app to hand it to.
      if (source.kind === "project") ctx.quickLook(item);
    },

    openWith(item: FileItem, app: string) {
      const path = localPath(item);
      if (path) void disk.openWith(path, app).catch((cause) => fail(cause, `${item.name} couldn't open.`));
    },

    rename(item: FileItem) {
      const source = item.source;
      if (source.kind === "drive") {
        ctx.ask.name({
          title: `Rename ${item.folder ? "folder" : "file"}`,
          initial: item.name,
          onConfirm: async (name) => {
            if (name === item.name) return;
            const renamed = await driveNative.rename(source.entry.space_id, source.entry.path, name);
            ctx.changed();
            ctx.select([`drive:${renamed.id}`]);
          },
        });
        return;
      }
      const path = localPath(item);
      if (!path) return;
      ctx.ask.name({
        title: `Rename ${item.folder ? "folder" : "file"}`,
        initial: item.name,
        onConfirm: async (name) => {
          if (name === item.name) return;
          let renamed = childOf(parentOf(path), name);
          if (granted) renamed = (await disk.rename(path, name)).path;
          else await filesApi.rename(path, renamed);
          ctx.changed();
          ctx.select([renamed]);
        },
      });
    },

    create(kind: "folder" | "file") {
      if (place.kind === "space-drive") {
        const { spaceId, path: inside } = place;
        ctx.ask.name({
          title: kind === "folder" ? "New folder" : "New file",
          initial: kind === "folder" ? "untitled folder" : "untitled.txt",
          confirmLabel: "Create",
          onConfirm: async (name) => {
            const made =
              kind === "folder"
                ? await driveNative.createFolder(spaceId, inside, name)
                : await driveNative.write(spaceId, inside, name, new Uint8Array());
            ctx.changed();
            ctx.select([`drive:${made.id}`]);
          },
        });
        return;
      }
      if (!folder) return;
      ctx.ask.name({
        title: kind === "folder" ? "New folder" : "New file",
        initial: kind === "folder" ? "untitled folder" : "untitled.txt",
        confirmLabel: "Create",
        onConfirm: async (name) => {
          const path = childOf(folder, name);
          if (granted) await (kind === "folder" ? disk.createFolder(folder, name) : disk.createFile(folder, name));
          else await (kind === "folder" ? filesApi.createDir(path) : filesApi.createFile(path));
          ctx.changed();
          ctx.select([path]);
        },
      });
    },

    duplicate(items: FileItem[]) {
      const paths = pathsOf(items);
      void guard(async () => {
        const made = granted
          ? await disk.duplicate(paths)
          : await Promise.all(paths.map(async (path) => (await filesApi.duplicate(path)).path));
        ctx.select(made);
      }, "Couldn't duplicate.");
    },

    compress(items: FileItem[]) {
      const paths = pathsOf(items);
      const where = { from: paths.length === 1 ? paths[0] : parentOf(paths[0]), to: parentOf(paths[0]), items: paths.length };
      void guard(async () => ctx.select([await ctx.run("Compressing", () => disk.compress(paths), where)]), "Couldn't zip.");
    },

    extract(item: FileItem) {
      const path = localPath(item);
      if (path)
        void guard(
          async () => ctx.select([await ctx.run("Expanding", () => disk.extract(path), { from: path, to: parentOf(path), items: 1 })]),
          "Couldn't expand.",
        );
    },

    makeAlias(item: FileItem) {
      const path = localPath(item);
      if (path) void guard(async () => ctx.select([await disk.makeLink(path)]), "Couldn't make an alias.");
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
      const done = granted ? disk.copyToClipboard(paths, cut) : filesApi.clipboardSetFiles(paths);
      void done.catch((cause) => fail(cause, "Couldn't copy."));
    },

    async paste() {
      if (!folder) return;
      if (!granted) {
        await filesApi.pasteClipboard(folder).then(
          (result) => {
            ctx.select(result.created.map((made) => made.path));
            if (result.failed.length) notify({ message: `${countText(result.failed.length)} couldn't be pasted.`, tone: "error" });
          },
          (cause) => fail(cause, "Couldn't paste."),
        );
        return ctx.changed();
      }
      const clip = await disk.clipboard().catch(() => null);
      if (clip?.paths.length) await transfer(clip.cut ? "move" : "copy", clip.paths, folder);
    },

    copyPath(items: FileItem[]) {
      const pathOf = (item: FileItem) =>
        localPath(item) ?? (item.source.kind === "drive" ? item.source.entry.path : item.name);
      const text = items.map(pathOf).join("\n");
      void navigator.clipboard.writeText(text).catch((cause) => fail(cause, "Couldn't copy the path."));
    },

    reveal(item: FileItem) {
      const source = item.source;
      const done =
        source.kind === "drive"
          ? driveNative.reveal(source.entry.space_id, source.entry.path)
          : source.kind === "disk"
            ? disk.reveal(source.entry.path)
            : source.kind === "project"
              ? filesApi.reveal(source.path)
              : null;
      void done?.catch((cause) => fail(cause, "Couldn't show it."));
    },

    async trash(items: FileItem[]) {
      await guard(async () => {
        const drive = items.flatMap((item) => (item.source.kind === "drive" ? [item.source.entry] : []));
        for (const entry of drive) await driveNative.trash(entry.space_id, entry.path);
        const paths = pathsOf(items);
        if (!paths.length) return;
        if (granted) await disk.trash(paths);
        else for (const path of paths) await filesApi.trash(path);
      }, "Couldn't move it to the Trash.");
    },

    deleteNow(items: FileItem[]) {
      const paths = pathsOf(items);
      if (!paths.length || !granted) return;
      void ctx.ask.confirm({
        title: `Delete ${titleFor(items)} immediately?`,
        what: "It skips the Trash. You can't undo this.",
        onConfirm: async () => {
          const failed = await disk.deleteForever(paths);
          ctx.changed();
          if (failed.length) throw new Error(failed[0].error);
        },
      });
    },

    putBack(items: FileItem[]) {
      void guard(async () => {
        const trashed = items.flatMap((item) => (item.source.kind === "trash" ? [item.source.item.id] : []));
        const agent = items.flatMap((item) => (item.source.kind === "agent-trash" ? [item.source.item.id] : []));
        const drive = items.flatMap((item) => (item.source.kind === "drive-trash" ? [item.source.entry] : []));
        if (trashed.length) failures((await disk.putBack(trashed)).failed, "be put back");
        // Something already back in its place keeps both, so nothing is lost.
        if (agent.length) failures((await disk.agentTrashPutBack(agent, "keep-both")).failed, "be put back");
        for (const entry of drive) await driveNative.restore(entry.space_id, entry.id);
      }, "Couldn't put it back.");
    },

    deleteFromTrash(items: FileItem[]) {
      void ctx.ask.confirm({
        title: `Delete ${titleFor(items)}?`,
        what: "It is deleted for good. You can't undo this.",
        onConfirm: async () => {
          try {
            const trashed = items.flatMap((item) => (item.source.kind === "trash" ? [item.source.item.trashedPath] : []));
            const agent = items.flatMap((item) => (item.source.kind === "agent-trash" ? [item.source.item.id] : []));
            const drive = items.flatMap((item) => (item.source.kind === "drive-trash" ? [item.source.entry] : []));
            const failed = [
              ...(trashed.length ? await disk.deleteForever(trashed) : []),
              ...(agent.length ? await disk.agentTrashDelete(agent) : []),
            ];
            for (const entry of drive) await driveNative.purge(entry.space_id, entry.id);
            if (failed.length) throw new Error(failed[0].error);
          } finally {
            ctx.changed();
          }
        },
      });
    },

    emptyAgentTrash() {
      void ctx.ask.confirm({
        title: "Empty agent trash?",
        what: "Everything agents moved there is deleted for good. You can't undo this.",
        confirmLabel: "Empty",
        onConfirm: async () => {
          const failed = await disk.agentTrashEmpty().finally(ctx.changed);
          if (failed.length) throw new Error(failed[0].error);
        },
      });
    },

    /** Items dropped on a folder (a disk path) or a Space drive's folder; ⌥ copies. */
    async drop(items: FileItem[], target: { dir: string } | { spaceId: string; path: string }, copy: boolean) {
      if (!("dir" in target)) {
        // Within one Space's drive, a drop moves its items there, as Finder moves within a disk.
        const own = items.flatMap((item) =>
          item.source.kind === "drive" && item.source.entry.space_id === target.spaceId ? [item.source.entry] : [],
        );
        const moving = own.filter((entry) => parentOf(entry.path) !== target.path && entry.path !== target.path);
        if (moving.length)
          await guard(async () => {
            const moved = await driveNative.move(target.spaceId, moving.map((entry) => entry.path), target.path);
            if (moved.length < moving.length)
              notify({ message: `${countText(moving.length - moved.length)} couldn't be moved.`, tone: "error" });
          }, "Couldn't move it.");
      }
      const paths = pathsOf(items);
      if (!paths.length) return;
      if ("dir" in target) return transfer(copy ? "copy" : "move", paths, target.dir);
      // Into a Space's drive, a file from this computer is always a copy: the drive keeps its own.
      await guard(
        () =>
          ctx.run("Copying", () => copyIntoDrive(target.spaceId, target.path, items), {
            from: paths.length === 1 ? paths[0] : parentOf(paths[0]),
            to: target.path,
            items: items.length,
          }),
        "Couldn't copy it into the Space.",
      );
    },

    batchRename(items: FileItem[]) {
      ctx.ask.batchRename(pathsOf(items), (created) => {
        ctx.changed();
        ctx.select(created);
      });
    },

    compare(items: FileItem[]) {
      const [left, right] = pathsOf(items);
      if (left && right) ctx.ask.compare(left, right);
    },

    duplicates(dir: string) {
      ctx.ask.duplicates(dir);
    },

    /** Go to Folder (⇧⌘G): a path typed in full, or from the home folder with `~`. */
    goToFolder(home: string | undefined) {
      if (!granted) return;
      ctx.ask.name({
        title: "Go to folder",
        initial: folder ?? home ?? "",
        confirmLabel: "Go",
        fieldLabel: "Folder",
        onConfirm: async (typed) => {
          const path = typed === "~" ? home : typed.startsWith("~/") && home ? childOf(home, typed.slice(2)) : typed;
          if (!path) throw new Error("Write the folder's full path.");
          const info = await disk.info(path).catch(() => null);
          if (!info) throw new Error("There's no folder there.");
          if (info.entry.kind !== "folder") throw new Error(`${info.entry.name} isn't a folder.`);
          ctx.go({ kind: "disk", path: info.entry.path });
        },
      });
    },
  };
  return {
    ...actions,
    canPaste: Boolean(folder) && (granted || project),
    canCreate: (Boolean(folder) && (granted || project)) || place.kind === "space-drive",
  };
}

export type FileActions = ReturnType<typeof createFileActions>;
