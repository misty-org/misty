import { cn } from "@/shared/ui";
import MDEditor, { type ICommand, type PreviewType } from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { Columns2, Eye, PenLine } from "lucide-react";
import { useMemo, useState } from "react";

interface TaskMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
  className?: string;
  autoFocus?: boolean;
  defaultPreview?: PreviewType;
}

export function TaskMarkdownEditor({
  value,
  onChange,
  placeholder = "Add notes",
  disabled = false,
  minHeight = 220,
  className,
  autoFocus = false,
  defaultPreview = "edit",
}: TaskMarkdownEditorProps) {
  const [preview, setPreview] = useState<PreviewType>(defaultPreview);

  const extraCommands: ICommand[] = useMemo(() => {
    return [
      {
        name: "edit",
        keyCommand: "preview",
        value: "edit",
        buttonProps: {
          "aria-label": "Write mode",
          title: "Write mode (editor only)",
        },
        icon: <PenLine className="size-3.5" />,
        execute: () => setPreview("edit"),
      },
      {
        name: "live",
        keyCommand: "preview",
        value: "live",
        buttonProps: {
          "aria-label": "Split view",
          title: "Split view (editor & preview)",
        },
        icon: <Columns2 className="size-3.5" />,
        execute: () => setPreview("live"),
      },
      {
        name: "preview",
        keyCommand: "preview",
        value: "preview",
        buttonProps: {
          "aria-label": "Preview mode",
          title: "Preview mode (preview only)",
        },
        icon: <Eye className="size-3.5" />,
        execute: () => setPreview("preview"),
      },
    ];
  }, []);

  return (
    <div
      data-color-mode="dark"
      className={cn(
        "group/editor w-full overflow-hidden rounded-xl border border-charcoal-border/70",
        "bg-charcoal-workspace/50 transition-all focus-within:border-charcoal-border",
        "focus-within:ring-1 focus-within:ring-charcoal-border/50",
        "[&_.w-md-editor]:!bg-transparent [&_.w-md-editor]:!border-0 [&_.w-md-editor]:!shadow-none",
        "[&_.w-md-editor-toolbar]:!bg-charcoal-card/40 [&_.w-md-editor-toolbar]:!border-b [&_.w-md-editor-toolbar]:!border-charcoal-border/50",
        "[&_.w-md-editor-toolbar_li_button]:!text-cream-muted [&_.w-md-editor-toolbar_li_button]:!rounded-md",
        "[&_.w-md-editor-toolbar_li_button:hover]:!text-cream-bright [&_.w-md-editor-toolbar_li_button:hover]:!bg-charcoal-hover",
        "[&_.w-md-editor-toolbar_li.active_button]:!bg-charcoal-active [&_.w-md-editor-toolbar_li.active_button]:!text-cream-bright",
        "[&_.w-md-editor-text]:!text-cream [&_.w-md-editor-text_textarea]:!text-cream",
        "[&_.w-md-editor-text_textarea]:!font-normal [&_.w-md-editor-text_textarea]:!text-sm",
        "[&_.w-md-editor-text_textarea]:!placeholder:text-cream-faint/45",
        "[&_.w-md-editor-preview]:!bg-charcoal-workspace/40 [&_.w-md-editor-preview]:!text-cream",
        "[&_.w-md-editor-preview]:!border-l [&_.w-md-editor-preview]:!border-charcoal-border/60 [&_.w-md-editor-preview]:!shadow-none",
        "[&_.wmde-markdown]:!bg-transparent [&_.wmde-markdown]:!text-cream [&_.wmde-markdown]:!text-sm",
        className,
      )}
    >
      <MDEditor
        value={value}
        onChange={(val) => onChange(val ?? "")}
        height={minHeight}
        minHeight={160}
        preview={preview}
        extraCommands={extraCommands}
        textareaProps={{
          placeholder,
          disabled,
          autoFocus,
          "aria-label": placeholder,
        }}
        previewOptions={{
          rehypePlugins: [],
        }}
      />
    </div>
  );
}
