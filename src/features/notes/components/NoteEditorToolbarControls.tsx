import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@/shared/ui";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Braces,
  ChevronDown,
  Code2,
  Heading,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";

export function NoteToolbarStructureControls({ editor }: { editor: Editor }) {
  return (
    <>
      <ToolbarGroup>
        <ToolButton label="Undo" Icon={Undo2} onClick={() => editor.chain().focus().undo().run()} />
        <ToolButton label="Redo" Icon={Redo2} onClick={() => editor.chain().focus().redo().run()} />
      </ToolbarGroup>
      <ToolbarGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="misty-tiptap-tool gap-1"
              aria-label="Headings"
            >
              <Heading size={17} />
              <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
              <Pilcrow /> Text
            </DropdownMenuItem>
            {[1, 2, 3, 4].map((level) => (
              <DropdownMenuItem
                key={level}
                onSelect={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleHeading({ level: level as 1 | 2 | 3 | 4 })
                    .run()
                }
              >
                <Heading /> Heading {level}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="misty-tiptap-tool gap-1"
              aria-label="Lists"
            >
              <List size={17} />
              <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => editor.chain().focus().toggleBulletList().run()}>
              <List /> Bullet list
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.chain().focus().toggleOrderedList().run()}>
              <ListOrdered /> Numbered list
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.chain().focus().toggleTaskList().run()}>
              <ListChecks /> To-do list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolButton
          label="Blockquote"
          Icon={Quote}
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolButton
          label="Code block"
          Icon={Braces}
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
      </ToolbarGroup>
    </>
  );
}

export function NoteToolbarInlineControls({ editor }: { editor: Editor }) {
  const link = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL", previous ?? "https://");
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };
  return (
    <ToolbarGroup>
      <ToolButton
        label="Bold"
        Icon={Bold}
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        label="Italic"
        Icon={Italic}
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        label="Strikethrough"
        Icon={Strikethrough}
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolButton
        label="Inline code"
        Icon={Code2}
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <ToolButton
        label="Underline"
        Icon={Underline}
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="misty-tiptap-tool" aria-label="Highlight">
            <Highlighter size={17} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-auto gap-1 p-2">
          {["#7255d9", "#d7a928", "#3f8e72", "#b95656"].map((color) => (
            <button
              key={color}
              type="button"
              className="size-6 rounded-full ring-1 ring-white/15"
              style={{ background: color }}
              aria-label={`Highlight ${color}`}
              onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
            />
          ))}
        </PopoverContent>
      </Popover>
      <ToolButton label="Link" Icon={Link2} active={editor.isActive("link")} onClick={link} />
    </ToolbarGroup>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>;
}

function ToolButton(props: {
  label: string;
  Icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      className={cn("misty-tiptap-tool", props.active && "is-active")}
      onClick={props.onClick}
    >
      <props.Icon size={17} />
    </Button>
  );
}
