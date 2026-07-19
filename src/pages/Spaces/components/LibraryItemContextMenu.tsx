import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArchiveRestore, ChevronLeft, ClipboardCopy, Copy, FolderPlus, Pencil, Star, Tags, Trash2 } from "lucide-react";
import type { LibraryAlbum, SpaceLibraryItem } from "../../../spaces/types";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  const [showAlbums, setShowAlbums] = useState(false);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    setShowAlbums(false);
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onCloseRef.current();
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    const closeOnBlur = () => onCloseRef.current();
    const closeOnScroll = () => onCloseRef.current();
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("blur", closeOnBlur);
    document.addEventListener("scroll", closeOnScroll, true);
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("blur", closeOnBlur);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [props.state.itemId]);

  const run = (action: () => void) => {
    props.onClose();
    action();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[2147483000] w-[224px] overflow-hidden rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-dropdown-bg,var(--misty-surface)))] p-1.5 text-[var(--misty-text)] shadow-[0_20px_55px_var(--misty-shadow)] backdrop-blur-xl"
      style={{ left: props.state.left, top: props.state.top }}
      role="menu"
      aria-label={`Actions for ${props.item.display_name}`}
      onContextMenu={(event) => event.preventDefault()}
    >
      {showAlbums ? <>
        <MenuButton icon={<ChevronLeft size={15}/>} label="Back" onClick={() => setShowAlbums(false)}/>
        <MenuSeparator/>
        <p className="mb-1 mt-1 px-2.5 text-[10px] font-semibold text-[var(--misty-text-subtle)]">Add to album</p>
        <div className="max-h-52 overflow-y-auto">
          {props.albums.map((album) => <MenuButton key={album.id} icon={<FolderPlus size={15}/>} label={album.name} onClick={() => run(() => props.onAddToAlbum(album.id))}/>) }
          {props.albums.length === 0 ? <p className="m-0 px-2.5 py-2 text-xs text-[var(--misty-text-subtle)]">No albums yet.</p> : null}
        </div>
      </> : <>
        {props.deleted ? props.canEdit ? <MenuButton icon={<ArchiveRestore size={15}/>} label="Restore" onClick={() => run(props.onRestore)}/> : null : <>
          {props.canCopy ? <MenuButton icon={<ClipboardCopy size={15}/>} label="Copy" onClick={() => run(props.onCopy)}/> : null}
          {props.canCopy && props.canEdit ? <MenuButton icon={<Copy size={15}/>} label="Duplicate" onClick={() => run(props.onDuplicate)}/> : null}
          {props.canEdit ? <>
            <MenuButton icon={<Pencil size={15}/>} label="Rename" onClick={() => run(props.onRename)}/>
            <MenuButton icon={<Tags size={15}/>} label="Tags" onClick={() => run(props.onEditTags)}/>
            {props.albums.length > 0 ? <>
              <MenuSeparator/>
              <MenuButton icon={<FolderPlus size={15}/>} label="Add to album…" onClick={() => setShowAlbums(true)}/>
            </> : null}
            <MenuButton icon={<Star size={15} fill={props.item.favorite ? "currentColor" : "none"}/>} label={props.item.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => run(props.onToggleFavorite)}/>
            <MenuSeparator/>
            <MenuButton danger icon={<Trash2 size={15}/>} label="Delete" onClick={() => run(props.onTrash)}/>
          </> : null}
        </>}
      </>}
    </div>,
    document.body,
  );
}

function MenuButton(props: { danger?: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={`flex min-h-9 w-full items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-xs transition-colors ${props.danger ? "text-red-300 hover:bg-red-500/10 hover:text-red-200" : "text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]"}`} type="button" role="menuitem" onClick={props.onClick}><span className="grid size-5 shrink-0 place-items-center">{props.icon}</span><span className="min-w-0 flex-1 truncate">{props.label}</span></button>;
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-[var(--misty-divider-subtle)]" role="separator"/>;
}
