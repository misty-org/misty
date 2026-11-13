import { useEffect, useRef, useState } from "react";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  MenuItem,
  MenuSeparator,
  OverflowFadeText,
} from "@/shared/ui";
import {
  ArchiveRestore,
  AudioLines,
  ClipboardCopy,
  Copy,
  Pencil,
  Tags,
  Trash2,
} from "lucide-react";
export interface LibraryItemMenuState {
  itemId: string;
  left: number;
  top: number;
}

/** What can be done with one Library item, and how. */
export interface LibraryItemMenuActions {
  item: SpaceLibraryItem;
  canCopy: boolean;
  canEdit: boolean;
  deleted: boolean;
  onCopy: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onEditTags: () => void;
  onTrash: () => void;
  onRestore: () => void;
  /** Offered for audio and video when voice notes are on. */
  onTranscribe?: () => void;
}

/** Whether the item's menu has any rows: a viewer looking at Trash can do nothing with it. */
export function hasLibraryItemMenuRows(actions: LibraryItemMenuActions) {
  return !actions.deleted || actions.canEdit;
}

/** The rows of a Library item's menu, the same in its right-click menu and a list row's ⋯. */
export function LibraryItemMenuRows(props: LibraryItemMenuActions) {
  if (props.deleted)
    return props.canEdit ? (
      <MenuItem icon={<ArchiveRestore />} label="Restore" onSelect={props.onRestore} />
    ) : null;
  return (
    <>
      {props.canCopy ? (
        <MenuItem icon={<ClipboardCopy />} label="Copy" onSelect={props.onCopy} />
      ) : null}
      {props.onTranscribe ? (
        <MenuItem icon={<AudioLines />} label="Transcribe" onSelect={props.onTranscribe} />
      ) : null}
      {props.canCopy && props.canEdit ? (
        <MenuItem icon={<Copy />} label="Duplicate" onSelect={props.onDuplicate} />
      ) : null}
      {props.canEdit ? (
        <>
          <MenuItem icon={<Pencil />} label="Rename" onSelect={props.onRename} />
          <MenuItem icon={<Tags />} label="Edit tags" onSelect={props.onEditTags} />
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 />} label="Delete" onSelect={props.onTrash} />
        </>
      ) : null}
    </>
  );
}

export function LibraryItemContextMenu(
  props: LibraryItemMenuActions & { state: LibraryItemMenuState; onClose: () => void },
) {
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
        <ContextMenuLabel className="text-xs font-medium">
          <OverflowFadeText>{props.item.display_name}</OverflowFadeText>
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <LibraryItemMenuRows {...props} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
