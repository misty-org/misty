import { useEffect, useRef, useState } from "react";
import type { LibraryAlbum, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import {
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/shared/ui";
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
export interface LibraryItemMenuState {
  itemId: string;
  left: number;
  top: number;
}

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
        className="w-56"
        aria-label={`Actions for ${props.item.display_name}`}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ContextMenuLabel className="truncate text-xs font-medium text-cream-muted">
          {props.item.display_name}
        </ContextMenuLabel>
        <ContextMenuSeparator />

        {props.deleted ? (
          props.canEdit ? (
            <ContextMenuAction
              icon={<ArchiveRestore />}
              label="Restore"
              onSelect={props.onRestore}
            />
          ) : null
        ) : (
          <>
            {props.canCopy ? (
              <ContextMenuAction icon={<ClipboardCopy />} label="Copy" onSelect={props.onCopy} />
            ) : null}
            {props.canCopy && props.canEdit ? (
              <ContextMenuAction icon={<Copy />} label="Duplicate" onSelect={props.onDuplicate} />
            ) : null}
            {props.canEdit ? (
              <>
                <ContextMenuAction icon={<Pencil />} label="Rename" onSelect={props.onRename} />
                <ContextMenuAction icon={<Tags />} label="Edit tags" onSelect={props.onEditTags} />
                {props.albums.length ? (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <FolderPlus className="size-4" /> Add to album
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-52">
                      <ContextMenuLabel className="text-xs text-cream-muted">
                        Choose an album
                      </ContextMenuLabel>
                      <ContextMenuSeparator />
                      {props.albums.map((album) => (
                        <ContextMenuAction
                          icon={<FolderPlus className="size-4" />}
                          label={album.name}
                          key={album.id}
                          onSelect={() => props.onAddToAlbum(album.id)}
                        />
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                ) : null}
                <ContextMenuAction
                  icon={<Star fill={props.item.favorite ? "currentColor" : "none"} />}
                  label={props.item.favorite ? "Remove from favorites" : "Add to favorites"}
                  onSelect={props.onToggleFavorite}
                />
                <ContextMenuSeparator />
                <ContextMenuAction
                  destructive
                  icon={<Trash2 />}
                  label="Delete"
                  onSelect={props.onTrash}
                />
              </>
            ) : null}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
