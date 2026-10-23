import {
  DragHandleButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuItem,
} from "@/shared/ui";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  Copy,
  GripVertical,
  Heading,
  Highlighter,
  Link2,
  Pilcrow,
  Plus,
  Trash2,
} from "lucide-react";

export function NoteBlockHandle(props: {
  editor: Editor;
  block: {
    pos: number;
    node: JSONContent;
  } | null;
  noteId: string;
}) {
  const { editor, block } = props;
  const pos = block?.pos ?? Math.max(0, editor.state.selection.$from.before(1));
  const node = editor.state.doc.nodeAt(pos);
  const range = node
    ? {
        from: pos,
        to: pos + node.nodeSize,
      }
    : null;
  return (
    <div className="misty-tiptap-block-handle" data-misty-window-drag-block="true">
      <DragHandleButton
        label="Add block"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertContentAt(pos, {
              type: "paragraph",
            })
            .run()
        }
      >
        <Plus />
      </DragHandleButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <DragHandleButton label="Block actions" title="Drag or open block actions">
            <GripVertical />
          </DragHandleButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="left" className="w-52">
          <MenuItem
            icon={<Pilcrow />}
            label="Turn into text"
            onSelect={() => editor.chain().focus().setParagraph().run()}
          />
          <MenuItem
            icon={<Heading />}
            label="Turn into heading"
            onSelect={() =>
              editor
                .chain()
                .focus()
                .toggleHeading({
                  level: 2,
                })
                .run()
            }
          />
          <MenuItem
            icon={<Highlighter />}
            label="Highlight block"
            disabled={!range}
            onSelect={() =>
              range &&
              editor
                .chain()
                .focus()
                .setTextSelection(range)
                .toggleHighlight({
                  color: "#7255d9",
                })
                .run()
            }
          />
          <DropdownMenuSeparator />
          <MenuItem
            icon={<Copy />}
            label="Duplicate block"
            disabled={!node}
            onSelect={() =>
              node &&
              editor
                .chain()
                .focus()
                .insertContentAt(pos + node.nodeSize, node.toJSON())
                .run()
            }
          />
          <MenuItem
            icon={<Copy />}
            label="Copy to clipboard"
            disabled={!node}
            onSelect={() => node && void navigator.clipboard.writeText(node.textContent)}
          />
          <MenuItem
            icon={<Link2 />}
            label="Copy anchor link"
            onSelect={() =>
              void navigator.clipboard.writeText(
                `misty://notes/${props.noteId}#${String(node?.attrs.id || `block-${pos}`)}`,
              )
            }
          />
          <DropdownMenuSeparator />
          <MenuItem
            icon={<Trash2 />}
            label="Delete"
            disabled={!range}
            destructive
            onSelect={() => range && editor.chain().focus().deleteRange(range).run()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
