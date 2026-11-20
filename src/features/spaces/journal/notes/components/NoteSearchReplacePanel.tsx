import { FindAndReplacePluginKey } from "@tiptap/extension-find-and-replace";
import { useEditorState, type Editor } from "@tiptap/react";
import { useState, type KeyboardEvent } from "react";
import { FindBar } from "@misty/ui";

/** Find and replace in a note, on the shared find bar docked under the note's toolbar: the same
 * bar as code, previews and chats, over Tiptap's find-and-replace extension. */
export function NoteSearchReplacePanel(props: {
  editor: Editor;
  open: boolean;
  search: string;
  replace: string;
  onSearchChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onClose: () => void;
}) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  // Where the search is and how it matches, as the extension keeps them.
  const found = useEditorState({
    editor: props.editor,
    selector: ({ editor }) => {
      const state = editor ? FindAndReplacePluginKey.getState(editor.state) : undefined;
      return {
        total: state?.results.length ?? 0,
        index: state?.currentIndex ?? null,
        caseSensitive: state?.caseSensitive ?? false,
        wholeWord: state?.wholeWord ?? false,
        useRegex: state?.useRegex ?? false,
      };
    },
  });
  if (!props.open) return null;
  const commands = findCommands(props.editor);
  const hasQuery = props.search.length > 0;
  const total = found?.total ?? 0;
  const count =
    hasQuery && total > 0 ? `${(found?.index ?? 0) + 1}/${total}` : hasQuery ? "No results" : "";
  const onFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) commands.goToPreviousResult();
      else commands.goToNextResult();
    }
  };
  return (
    <FindBar
      label="Find in note"
      find={{
        value: props.search,
        onChange: props.onSearchChange,
        onKeyDown: onFindKeyDown,
      }}
      caseSensitive={found?.caseSensitive}
      onCaseSensitive={() => commands.setCaseSensitive(!found?.caseSensitive)}
      wholeWord={found?.wholeWord}
      onWholeWord={() => commands.setWholeWord(!found?.wholeWord)}
      regex={found?.useRegex}
      onRegex={() => commands.setUseRegex(!found?.useRegex)}
      count={count}
      empty={hasQuery && total === 0}
      canStep={total > 0}
      onPrevious={() => commands.goToPreviousResult()}
      onNext={() => commands.goToNextResult()}
      onClose={props.onClose}
      replace={{
        open: replaceOpen,
        onToggle: () => setReplaceOpen((open) => !open),
        canReplace: total > 0,
        onReplace: () => commands.replace(),
        onReplaceAll: () => commands.replaceAll(),
        value: props.replace,
        onChange: props.onReplaceChange,
        onKeyDown: (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            commands.replace();
          }
        },
      }}
    />
  );
}

type FindCommands = {
  setSearchTerm: (value: string) => boolean;
  setReplaceTerm: (value: string) => boolean;
  setCaseSensitive: (value: boolean) => boolean;
  setWholeWord: (value: boolean) => boolean;
  setUseRegex: (value: boolean) => boolean;
  goToPreviousResult: () => boolean;
  goToNextResult: () => boolean;
  replace: () => boolean;
  replaceAll: () => boolean;
};
export function findCommands(editor: Editor) {
  return editor.commands as unknown as FindCommands;
}
