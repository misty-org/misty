import {
  AppWindow,
  ClipboardCopy,
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
import {
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  TagDot,
  tagToneName,
} from "@misty/ui";
import type { FinderTag } from "@/features/files";
import { desktopOs } from "@/shared/platform/desktop_os";
import type { DriveEntry } from "../drive";
import type { FileActions } from "./file_actions";
import { isArchive } from "./format";
import { keys } from "./key_labels";
import { localPath, type FileItem, type FilesPlace } from "./model";
import { DiskOpenWithItems, DriveOpenWithItems } from "./OpenWithItems";
import type { DriveOpenApp } from "./use_drive_open_with";

export interface MenuContext {
  place: FilesPlace;
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
  const first = items[0].source;
  const deletable = first.kind !== "drive-trash" || ctx.canPurge(first.entry.space_id);
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
  if (source.kind === "trash" || source.kind === "agent-trash" || source.kind === "drive-trash")
    return ctx.picking ? null : <TrashRows items={items} ctx={ctx} />;
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
          {drive && one ? (
            <>
              <MenuSeparator />
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
          <MenuItem
            icon={Trash2}
            label="Move to Trash"
            shortcut={keys.trash}
            onSelect={() => void actions.trash(items)}
          />
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
