import { SuggestionItem, SuggestionList } from "@/shared/ui";
import type { Editor } from "@tiptap/react";
import {
  Braces,
  Heading,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Quote,
} from "lucide-react";

export type SuggestionState = {
  type: "slash" | "wiki";
  query: string;
  from: number;
  to: number;
  x: number;
  y: number;
};
export function updateSuggestion(editor: Editor, set: (value: SuggestionState | null) => void) {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock) return set(null);
  const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
  const wiki = before.match(/\[\[([^\]]*)$/);
  const slash = before.match(/(?:^|\s)\/([a-z\s]*)$/i);
  const match = wiki ?? slash;
  if (!match) return set(null);
  const coords = editor.view.coordsAtPos(editor.state.selection.from);
  set({
    type: wiki ? "wiki" : "slash",
    query: match[1] ?? "",
    from: editor.state.selection.from - match[0].trimStart().length,
    to: editor.state.selection.from,
    x: coords.left,
    y: coords.bottom + 8,
  });
}
export function SuggestionMenu(props: {
  editor: Editor;
  suggestion: SuggestionState;
  notes: Array<{
    id: string;
    title: string;
  }>;
  onClose: () => void;
}) {
  const slashItems = [
    {
      label: "Text",
      icon: Pilcrow,
      run: () => props.editor.chain().focus().setParagraph().run(),
    },
    {
      label: "Heading 1",
      icon: Heading,
      run: () =>
        props.editor
          .chain()
          .focus()
          .toggleHeading({
            level: 1,
          })
          .run(),
    },
    {
      label: "Heading 2",
      icon: Heading,
      run: () =>
        props.editor
          .chain()
          .focus()
          .toggleHeading({
            level: 2,
          })
          .run(),
    },
    {
      label: "Bullet list",
      icon: List,
      run: () => props.editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      run: () => props.editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "To-do list",
      icon: ListChecks,
      run: () => props.editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: "Blockquote",
      icon: Quote,
      run: () => props.editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Code block",
      icon: Braces,
      run: () => props.editor.chain().focus().toggleCodeBlock().run(),
    },
  ].filter((item) => item.label.toLowerCase().includes(props.suggestion.query.toLowerCase()));
  const notes = props.notes
    .filter((note) => note.title.toLowerCase().includes(props.suggestion.query.toLowerCase()))
    .slice(0, 8);
  return (
    <SuggestionList
      className="fixed layer-menu max-h-[360px] min-w-[250px] overflow-auto"
      style={{
        left: props.suggestion.x,
        top: props.suggestion.y,
      }}
    >
      <p className="mx-2 mb-1.5 mt-1 text-[11px] font-semibold text-cream-muted">
        {props.suggestion.type === "wiki" ? "Link to note" : "Insert block"}
      </p>
      {props.suggestion.type === "slash"
        ? slashItems.map((item) => (
            <SuggestionItem
              key={item.label}
              selected={false}
              onClick={() => {
                props.editor
                  .chain()
                  .focus()
                  .deleteRange({
                    from: props.suggestion.from,
                    to: props.suggestion.to,
                  })
                  .run();
                item.run();
                props.onClose();
              }}
            >
              <item.icon />
              {item.label}
            </SuggestionItem>
          ))
        : notes.map((note) => (
            <SuggestionItem
              key={note.id}
              selected={false}
              onClick={() => {
                props.editor
                  .chain()
                  .focus()
                  .deleteRange({
                    from: props.suggestion.from,
                    to: props.suggestion.to,
                  })
                  .insertContent({
                    type: "text",
                    text: note.title,
                    marks: [
                      {
                        type: "link",
                        attrs: {
                          href: `misty-note://${note.id}`,
                        },
                      },
                    ],
                  })
                  .run();
                props.onClose();
              }}
            >
              <Link2 />
              {note.title}
            </SuggestionItem>
          ))}
      {props.suggestion.type === "wiki" && notes.length === 0 ? (
        <span className="p-2 text-xs text-cream-muted">No matching notes</span>
      ) : null}
    </SuggestionList>
  );
}
