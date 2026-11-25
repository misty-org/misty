import {
  AppWindow,
  ClipboardCopy,
  CloudUpload,
  Copy,
  CopyPlus,
  Diff,
  Eraser,
  Eye,
  FileArchive,
  Files,
  FolderSearch,
  Info,
  Link,
  PackageOpen,
  Pencil,
  Scissors,
  SquareArrowOutUpRight,
  Star,
  StarOff,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import {
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  notify,
  TagDot,
  tagToneName,
} from "@misty/ui";
import type { FinderTag } from "@/features/files";
import { desktopOs } from "@/shared/platform/desktop_os";
import { driveNative, type DriveEntry } from "../drive";
import { useSpacesStore } from "../list/use_spaces_store";
import type { FileActions } from "./file_actions";
import { useFilesChoices } from "./files_choices";
import { isArchive } from "./format";
import { isMac, keys } from "./key_labels";
import {
  directlyInSpaceTrash,
  inSpaceTrash,
  isSpaceTrash,
  localPath,
  mayEmptySpaceTrash,
  type FileItem,
} from "./model";
import { DiskOpenWithItems, DriveOpenWithItems } from "./OpenWithItems";
import { targetsOf, usePane } from "./pane_context";
import { sourceOf } from "./sources";
import { useDriveOpenWith, type DriveOpenApp } from "./use_drive_open_with";
import { usePlacesStore } from "./use_files_places";

export interface MenuContext {
  granted: boolean;
  picking: boolean;
  macos: boolean;
  actions: FileActions;
  starred: ReadonlySet<string>;
  tags: FinderTag[];
  quickLook(item: FileItem): void;
  info(item: FileItem): void;
  driveApps(entry: DriveEntry): DriveOpenApp[];
  openDriveIn(entry: DriveEntry, appId: string): void;
  canPurge(spaceId: string): boolean;
}

function TagRows({ items, ctx }: { items: FileItem[]; ctx: MenuContext }) {
  return (
    <>
      {ctx.tags.map((tag) => {
        const on = items.every((item) => item.tags.some((other) => other.name === tag.name));
        return (
          <MenuCheckItem
            key={tag.name}
            icon={<TagDot color={tag.color} label={tagToneName(tag.color)} />}
            label={tag.name}
            checked={on}
            onCheckedChange={() => ctx.actions.tag(items, tag, !on)}
          />
        );
      })}
    </>
  );
}

function TrashRows({ items, ctx }: { items: FileItem[]; ctx: MenuContext }) {
  const deletable = sourceOf(items[0]).purge !== undefined;
  return (
    <>
      <MenuItem icon={Undo2} label="Put back" onSelect={() => ctx.actions.putBack(items)} />
      {deletable ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={Eraser}
            label="Delete immediately"
            danger
            onSelect={() => ctx.actions.deleteFromTrash(items)}
          />
        </>
      ) : null}
    </>
  );
}

export function ItemMenu({ items, ctx }: { items: FileItem[]; ctx: MenuContext }) {
  if (!items.length) return null;
  const item = items[0];
  const one = items.length === 1;
  const source = item.source;
  if (sourceOf(item).inTrash) return ctx.picking ? null : <TrashRows items={items} ctx={ctx} />;
  const { actions } = ctx;
  const onDisk = items.every((each) => each.source.kind === "disk") && ctx.granted;
  const local = items.every((each) => localPath(each) !== undefined);
  const drive = source.kind === "drive" ? source.entry : undefined;
  const path = localPath(item);
  const allStarred = onDisk && items.every((each) => ctx.starred.has(each.id));
  const folders = items.filter((each) => each.folder);
  const os = desktopOs();
  const reveal =
    os === "macos" ? "Reveal in Finder" : os === "windows" ? "Show in Explorer" : "Show in folder";
  const opensOutside = !item.folder && (onDisk || drive);

  return (
    <>
      <MenuItem
        icon={SquareArrowOutUpRight}
        label="Open"
        shortcut={keys.open}
        onSelect={() => actions.open(item)}
      />
      {one && opensOutside && !ctx.picking ? (
        <MenuSubmenu icon={AppWindow} label="Open with">
          {drive ? (
            <DriveOpenWithItems
              entry={drive}
              apps={ctx.driveApps(drive)}
              onOpen={ctx.openDriveIn}
            />
          ) : path ? (
            <DiskOpenWithItems path={path} onOpen={(app) => actions.openWith(item, app)} />
          ) : null}
        </MenuSubmenu>
      ) : null}
      {one && !item.folder ? (
        <MenuItem
          icon={Eye}
          label="Quick Look"
          shortcut={keys.quickLook}
          onSelect={() => ctx.quickLook(item)}
        />
      ) : null}
      {one ? (
        <MenuItem
          icon={Info}
          label="Get info"
          shortcut={keys.info}
          onSelect={() => ctx.info(item)}
        />
      ) : null}
      {ctx.picking ? null : (
        <>
          {drive && one && !isSpaceTrash(item) ? (
            <>
              <MenuSeparator />
              {drive.waits_large ? (
                <MenuItem
                  icon={CloudUpload}
                  label="Sync this file"
                  onSelect={() =>
                    void driveNative.syncLarge(drive.space_id, drive.path).catch(() =>
                      notify({
                        message: `${drive.name} couldn't be synced. Try again.`,
                        tone: "error",
                      }),
                    )
                  }
                />
              ) : null}
              <MenuItem
                icon={Pencil}
                label="Rename"
                shortcut={keys.rename}
                onSelect={() => actions.rename(item)}
              />
            </>
          ) : null}
          {local ? (
            <>
              <MenuSeparator />
              {one ? (
                <MenuItem
                  icon={Pencil}
                  label="Rename"
                  shortcut={keys.rename}
                  onSelect={() => actions.rename(item)}
                />
              ) : onDisk ? (
                <MenuItem
                  icon={Pencil}
                  label={`Rename ${items.length} items`}
                  onSelect={() => actions.batchRename(items)}
                />
              ) : null}
              <MenuItem
                icon={CopyPlus}
                label="Duplicate"
                shortcut={keys.duplicate}
                onSelect={() => actions.duplicate(items)}
              />
              {onDisk ? (
                one && isArchive(item.name) ? (
                  <MenuItem
                    icon={PackageOpen}
                    label="Expand"
                    onSelect={() => actions.extract(item)}
                  />
                ) : (
                  <MenuItem
                    icon={FileArchive}
                    label="Compress"
                    onSelect={() => actions.compress(items)}
                  />
                )
              ) : null}
              {onDisk && one ? (
                <MenuItem icon={Link} label="Make alias" onSelect={() => actions.makeAlias(item)} />
              ) : null}
            </>
          ) : null}
          {onDisk ? (
            <>
              <MenuSeparator />
              {ctx.macos && ctx.tags.length ? (
                <MenuSubmenu icon={Tag} label="Tags">
                  <TagRows items={items} ctx={ctx} />
                </MenuSubmenu>
              ) : null}
              <MenuItem
                icon={allStarred ? StarOff : Star}
                label={allStarred ? "Unstar" : "Star"}
                onSelect={() => actions.star(items, !allStarred)}
              />
            </>
          ) : null}
          <MenuSeparator />
          {local ? (
            <MenuItem
              icon={Copy}
              label="Copy"
              shortcut={keys.copy}
              onSelect={() => actions.clip(items, false)}
            />
          ) : null}
          {local && ctx.granted ? (
            <MenuItem
              icon={Scissors}
              label="Cut"
              shortcut={keys.cut}
              onSelect={() => actions.clip(items, true)}
            />
          ) : null}
          <MenuItem
            icon={ClipboardCopy}
            label="Copy path"
            shortcut={keys.copyPath}
            onSelect={() => actions.copyPath(items)}
          />
          {one ? (
            <MenuItem
              icon={FolderSearch}
              label={reveal}
              shortcut={keys.reveal}
              onSelect={() => actions.reveal(item)}
            />
          ) : null}
          {onDisk && (folders.length === 2 || (one && item.folder)) ? (
            <>
              <MenuSeparator />
              {folders.length === 2 && items.length === 2 ? (
                <MenuItem icon={Diff} label="Compare" onSelect={() => actions.compare(items)} />
              ) : null}
              {one && path ? (
                <MenuItem
                  icon={Files}
                  label="Find duplicates"
                  onSelect={() => actions.duplicates(path)}
                />
              ) : null}
            </>
          ) : null}
          <MenuSeparator />
          {drive && one && isSpaceTrash(item) ? (
            ctx.canPurge(drive.space_id) ? (
              <MenuItem
                icon={Trash2}
                label="Empty trash"
                danger
                onSelect={() => actions.emptyTrash(drive.space_id)}
              />
            ) : null
          ) : drive && items.every(inSpaceTrash) ? (
            <>
              {items.every(directlyInSpaceTrash) ? (
                <MenuItem icon={Undo2} label="Put back" onSelect={() => actions.putBack(items)} />
              ) : null}
              {ctx.canPurge(drive.space_id) ? (
                <MenuItem
                  icon={Eraser}
                  label="Delete immediately"
                  danger
                  onSelect={() => actions.deleteFromTrash(items)}
                />
              ) : null}
            </>
          ) : (
            <MenuItem
              icon={Trash2}
              label="Move to Trash"
              shortcut={keys.trash}
              onSelect={() => void actions.trash(items)}
            />
          )}
          {onDisk ? (
            <MenuItem
              icon={Eraser}
              label="Delete immediately"
              shortcut={keys.deleteNow}
              danger
              onSelect={() => actions.deleteNow(items)}
            />
          ) : null}
        </>
      )}
    </>
  );
}

export function ItemMenuFor({ item }: { item: FileItem }) {
  const pane = usePane();
  const [items] = useState(() => targetsOf(pane, item));
  const picking = Boolean(pane.pick);
  const starred = usePlacesStore((store) => store.starred);
  const tags = usePlacesStore((store) => store.tags);
  const spaces = useSpacesStore((store) => store.spaces);
  const { setInfo } = useFilesChoices(picking);
  const driveOpen = useDriveOpenWith();
  const ctx: MenuContext = {
    granted: pane.granted,
    picking,
    macos: isMac,
    actions: pane.actions,
    starred,
    tags,
    quickLook: (target) => pane.store.getState().setQuick(target),
    info: (target) => {
      pane.store.getState().select([target.id]);
      setInfo(true);
    },
    driveApps: driveOpen.appsFor,
    openDriveIn: driveOpen.openIn,
    canPurge: (spaceId) =>
      mayEmptySpaceTrash(spaces.find((space) => space.id === spaceId)?.permissions),
  };
  return <ItemMenu items={items} ctx={ctx} />;
}
