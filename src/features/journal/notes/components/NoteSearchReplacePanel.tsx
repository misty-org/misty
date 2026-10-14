import { Button, IconButton, Input } from "@/shared/ui";
import type { Editor } from "@tiptap/react";
import { Minus } from "lucide-react";

export function SearchReplacePanel(props: {
  editor: Editor;
  open: boolean;
  search: string;
  replace: string;
  onSearchChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onClose: () => void;
}) {
  if (!props.open) return null;
  const commands = findCommands(props.editor);
  return (
    <div className="misty-tiptap-search" role="search">
      <Input
        autoFocus
        value={props.search}
        placeholder="Find"
        aria-label="Find text"
        onChange={(event) => props.onSearchChange(event.target.value)}
      />
      <Input
        value={props.replace}
        placeholder="Replace"
        aria-label="Replacement text"
        onChange={(event) => props.onReplaceChange(event.target.value)}
      />
      <Button size="sm" variant="ghost" onClick={() => commands.goToPreviousResult()}>
        Previous
      </Button>
      <Button size="sm" variant="ghost" onClick={() => commands.goToNextResult()}>
        Next
      </Button>
      <Button size="sm" variant="ghost" onClick={() => commands.replace()}>
        Replace
      </Button>
      <Button size="sm" variant="ghost" onClick={() => commands.replaceAll()}>
        All
      </Button>
      <IconButton size="md" label="Close search" onClick={props.onClose}>
        <Minus size={16} />
      </IconButton>
    </div>
  );
}
type FindCommands = {
  setSearchTerm: (value: string) => boolean;
  setReplaceTerm: (value: string) => boolean;
  goToPreviousResult: () => boolean;
  goToNextResult: () => boolean;
  replace: () => boolean;
  replaceAll: () => boolean;
};
export function findCommands(editor: Editor) {
  return editor.commands as unknown as FindCommands;
}
