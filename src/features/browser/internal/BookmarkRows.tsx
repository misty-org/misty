import { Folder, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  ListRow,
  ListRowButton,
  MenuItem,
  MenuTrigger,
  itemToneClass,
  itemTones,
} from "@/shared/ui";
import { removeBookmark, type Bookmark, type BookmarkFolder } from "@/features/bookmarks/library";
import { SiteIcon } from "./InternalPageFrame";
import type { BrowserInternalPageProps } from "./types";

type Open = Pick<BrowserInternalPageProps, "navigate" | "openInNewView">;

export function BookmarkFolderRow(props: {
  folder: BookmarkFolder;
  count: number;
  onOpen(): void;
  onRename(): void;
  onMove(): void;
  onRemove(): void;
}) {
  const { folder } = props;
  return (
    <ListRow>
      <span className="grid size-6 shrink-0 place-items-center">
        <Folder size={16} className={itemToneClass(itemTones.folder)} aria-hidden />
      </span>
      <ListRowButton onClick={props.onOpen}>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-1.5">
          <span className="max-w-full truncate text-sm text-cream-bright">{folder.name}</span>
          <span className="text-xs text-cream-muted">
            {props.count === 1 ? "1 item" : `${props.count} items`}
          </span>
        </span>
      </ListRowButton>
      <DropdownMenu modal={false}>
        <MenuTrigger
          iconOnly
          label={`Manage folder ${folder.name}`}
          icon={<MoreHorizontal size={16} />}
        />
        <DropdownMenuContent align="end">
          <MenuItem label="Open folder" onSelect={props.onOpen} />
          <MenuItem label="Rename folder" onSelect={props.onRename} />
          <MenuItem label="Move folder" onSelect={props.onMove} />
          <DropdownMenuSeparator />
          <MenuItem label="Remove folder, keep contents" onSelect={props.onRemove} />
        </DropdownMenuContent>
      </DropdownMenu>
    </ListRow>
  );
}

export function BookmarkLinkRow(
  props: Open & { bookmark: Bookmark; location?: string; onEdit(): void },
) {
  const b = props.bookmark;
  return (
    <ListRow>
      <SiteIcon url={b.url} />
      <ListRowButton
        title={b.url}
        onClick={(event) =>
          event.metaKey || event.ctrlKey ? props.openInNewView(b.url) : props.navigate(b.url)
        }
      >
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-1.5">
          <span className="max-w-full truncate text-sm text-cream-bright">{b.title}</span>
          <span className="max-w-full truncate text-xs text-cream-muted">{b.url}</span>
        </span>
        {props.location && (
          <span className="max-w-48 truncate text-xs text-cream-muted">{props.location}</span>
        )}
      </ListRowButton>
      <DropdownMenu modal={false}>
        <MenuTrigger
          iconOnly
          label={`Manage bookmark ${b.title}`}
          icon={<MoreHorizontal size={16} />}
        />
        <DropdownMenuContent align="end">
          <MenuItem label="Open in new tab" onSelect={() => props.openInNewView(b.url)} />
          <MenuItem label="Edit bookmark" onSelect={props.onEdit} />
          <DropdownMenuSeparator />
          <MenuItem label="Remove bookmark" onSelect={() => removeBookmark(b.id)} />
        </DropdownMenuContent>
      </DropdownMenu>
    </ListRow>
  );
}
