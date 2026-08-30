import { Button } from "@/shared/ui";
import {
  Bold,
  Code,
  Heading,
  Italic,
  Link,
  List,
  ListOrdered,
  Paperclip,
  Quote,
} from "lucide-react";
import type { RefObject } from "react";

export function ComposerFormattingBar(props: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onTextChange: (nextText: string) => void;
  onAttachClick: () => void;
}) {
  const { textareaRef, text, onTextChange, onAttachClick } = props;

  const insertSyntax = (prefix: string, suffix = "") => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onTextChange(text + prefix + suffix);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = text.substring(start, end);
    const replacement = prefix + selected + suffix;
    const next = text.substring(0, start) + replacement + text.substring(end);
    onTextChange(next);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  return (
    <div className="flex items-center gap-0.5 border-b border-charcoal-border/60 bg-charcoal-card/40 px-2 py-1">
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Bold"
        title="Bold (Markdown: **text**)"
        onClick={() => insertSyntax("**", "**")}
      >
        <Bold className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Italic"
        title="Italic (Markdown: *text*)"
        onClick={() => insertSyntax("*", "*")}
      >
        <Italic className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Heading"
        title="Heading (Markdown: ### Heading)"
        onClick={() => insertSyntax("### ")}
      >
        <Heading className="size-3.5" />
      </Button>
      <span className="mx-1 h-3.5 w-px bg-charcoal-border" aria-hidden="true" />
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Bullet list"
        title="Bullet list (Markdown: - Item)"
        onClick={() => insertSyntax("- ")}
      >
        <List className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Numbered list"
        title="Numbered list (Markdown: 1. Item)"
        onClick={() => insertSyntax("1. ")}
      >
        <ListOrdered className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Quote"
        title="Quote (Markdown: > Quote)"
        onClick={() => insertSyntax("> ")}
      >
        <Quote className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Code"
        title="Code (Markdown: `code`)"
        onClick={() => insertSyntax("`", "`")}
      >
        <Code className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Link"
        title="Link (Markdown: [text](url))"
        onClick={() => insertSyntax("[", "](https://)")}
      >
        <Link className="size-3.5" />
      </Button>
      <span className="mx-1 h-3.5 w-px bg-charcoal-border" aria-hidden="true" />
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-cream-faint hover:text-cream"
        aria-label="Attach file"
        title="Attach files"
        onClick={onAttachClick}
      >
        <Paperclip className="size-3.5" />
      </Button>
    </div>
  );
}
