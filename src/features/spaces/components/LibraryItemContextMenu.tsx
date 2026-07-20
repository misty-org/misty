import type { LibraryItemMenuState } from "@/models/interfaces/features/spaces/components/LibraryItemContextMenu";
export type { LibraryItemMenuState } from "@/models/interfaces/features/spaces/components/LibraryItemContextMenu";
import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  ClipboardCopy,
  Copy,
  FolderPlus,
  Pencil,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/ui";
import type { LibraryAlbum, SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";

export function LibraryItemContextMenu(props: {
  state: LibraryItemMenuState;
  item: SpaceLibraryItem;
  albums: LibraryAlbum[];
  canCopy: boolean;
  canEdit: boolean;
  deleted: boolean;
  onClose: () => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onEditTags: () => void;
  onAddToAlbum: (albumId: string) => void;
  onToggleFavorite: () => void;
  onTrash: () => void;
  onRestore: () => void;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const onCloseRef = useRef(props.onClose);
  const [open, setOpen] = useState(false);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    setOpen(false);
    const frame = window.requestAnimationFrame(() => {
      triggerRef.current?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: props.state.left,
          clientY: props.state.top,
        }),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.state.itemId, props.state.left, props.state.top]);

  return (
    <ContextMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) onCloseRef.current();
      }}
    >
      <ContextMenuTrigger asChild>
        <span
          ref={triggerRef}
          className="pointer-events-none fixed size-px"
          style={{ left: props.state.left, top: props.state.top }}
          aria-hidden="true"
        />
      </ContextMenuTrigger>
      <ContextMenuContent
        className="z-[var(--misty-layer-menu)] w-56"
        aria-label={`Actions for ${props.item.display_name}`}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ContextMenuLabel className="truncate text-xs font-medium text-muted-foreground">
          {props.item.display_name}
        </ContextMenuLabel>
        <ContextMenuSeparator />

        {props.deleted ? (
          props.canEdit ? (
            <MenuItem icon={<ArchiveRestore />} label="Restore" onSelect={props.onRestore} />
          ) : null
        ) : (
          <>
            {props.canCopy ? (
              <MenuItem icon={<ClipboardCopy />} label="Copy" onSelect={props.onCopy} />
            ) : null}
            {props.canCopy && props.canEdit ? (
              <MenuItem icon={<Copy />} label="Duplicate" onSelect={props.onDuplicate} />
            ) : null}
            {props.canEdit ? (
              <>
                <MenuItem icon={<Pencil />} label="Rename" onSelect={props.onRename} />
                <MenuItem icon={<Tags />} label="Edit tags" onSelect={props.onEditTags} />
                {props.albums.length ? (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger className="gap-2 text-xs">
                      <FolderPlus className="size-4" /> Add to album
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="z-[var(--misty-layer-menu)] w-52">
                      <ContextMenuLabel className="text-xs text-muted-foreground">
                        Choose an album
                      </ContextMenuLabel>
                      <ContextMenuSeparator />
                      {props.albums.map((album) => (
                        <ContextMenuItem
                          className="gap-2 text-xs"
                          key={album.id}
                          onSelect={() => props.onAddToAlbum(album.id)}
                        >
                          <FolderPlus className="size-4" />
                          <span className="truncate">{album.name}</span>
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                ) : null}
                <MenuItem
                  icon={<Star fill={props.item.favorite ? "currentColor" : "none"} />}
                  label={props.item.favorite ? "Remove from favorites" : "Add to favorites"}
                  onSelect={props.onToggleFavorite}
                />
                <ContextMenuSeparator />
                <MenuItem danger icon={<Trash2 />} label="Delete" onSelect={props.onTrash} />
              </>
            ) : null}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenuItem({
  danger,
  icon,
  label,
  onSelect,
}: {
  danger?: boolean;
  icon: React.ReactElement<{ className?: string }>;
  label: string;
  onSelect: () => void;
}) {
  return (
    <ContextMenuItem
      className={`gap-2 text-xs ${danger ? "text-destructive focus:text-destructive" : ""}`}
      onSelect={onSelect}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      {label}
    </ContextMenuItem>
  );
}
