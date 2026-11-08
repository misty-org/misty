import { Button, Separator } from "@/shared/ui";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ImagePlus,
  Search,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  NoteToolbarInlineControls,
  NoteToolbarStructureControls,
  ToolButton,
} from "./NoteEditorToolbarControls";

/**
 * Based on Tiptap's MIT-licensed Simple Editor template. Its toolbar groups
 * and responsive horizontal overflow intentionally follow the upstream code.
 * https://tiptap.dev/docs/ui-components/templates/simple-editor
 */

export function NoteEditorToolbar(props: {
  editor: Editor;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  onAddImage: () => void;
}) {
  const { editor } = props;
  return (
    <div className="misty-tiptap-toolbar" role="toolbar" aria-label="Text formatting">
      <NoteToolbarStructureControls editor={editor} />
      <ToolbarRule />
      <ToolbarRule />
      <NoteToolbarInlineControls editor={editor} />
      <ToolbarRule />
      <ToolbarGroup>
        <ToolButton
          label="Superscript"
          Icon={SuperscriptIcon}
          active={editor.isActive("superscript")}
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
        />
        <ToolButton
          label="Subscript"
          Icon={SubscriptIcon}
          active={editor.isActive("subscript")}
          onClick={() => editor.chain().focus().toggleSubscript().run()}
        />
      </ToolbarGroup>
      <ToolbarRule />
      <ToolbarGroup>
        <ToolButton
          label="Align left"
          Icon={AlignLeft}
          active={editor.isActive({
            textAlign: "left",
          })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        />
        <ToolButton
          label="Align center"
          Icon={AlignCenter}
          active={editor.isActive({
            textAlign: "center",
          })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        />
        <ToolButton
          label="Align right"
          Icon={AlignRight}
          active={editor.isActive({
            textAlign: "right",
          })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        />
        <ToolButton
          label="Justify"
          Icon={AlignJustify}
          active={editor.isActive({
            textAlign: "justify",
          })}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        />
      </ToolbarGroup>
      <ToolbarRule />
      <ToolbarGroup>
        <Button variant="toolbar" size="sm" className="gap-1.5 px-2" onClick={props.onAddImage}>
          <ImagePlus size={17} />
          Add
        </Button>
      </ToolbarGroup>
      <div className="min-w-2 flex-1" />
      <ToolbarGroup>
        <ToolButton
          label="Search and replace"
          Icon={Search}
          active={props.searchOpen}
          onClick={() => props.setSearchOpen(!props.searchOpen)}
        />
      </ToolbarGroup>
    </div>
  );
}
function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>;
}
function ToolbarRule() {
  return <Separator orientation="vertical" className="mx-1.5 h-6 shrink-0" />;
}
