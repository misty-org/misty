import type { ChatComposerSuggestion } from "@/models/types/features/spaces/SpaceChat";
import type { MistyPickerSource } from "@/models/interfaces/features/picker/MistyPicker";
import type { SpaceChatDraft } from "./useSpaceChatDraft";
import type { ChatSuggestionsState } from "./useChatSuggestions";

const FILES_SHORTCUT = /(^|\s)@files\s*$/i;
const LIBRARY_SHORTCUT = /(^|\s)@library\s*$/i;
const TRAILING_MENTION = /(?:^|\s)@([^\s@]*)$/;

/**
 * Turns typing into mentions, attachments and picker launches.
 *
 * Typing `@files` or `@library` is a shortcut that opens the picker instead of
 * inserting text, so those two patterns are consumed before anything else.
 */
export function useComposerInput(options: {
  draft: SpaceChatDraft;
  suggestions: ChatSuggestionsState;
  canWriteMessages: boolean;
  canUploadAttachments: boolean;
  canBrowseLibrary: boolean;
  openPicker: (source: MistyPickerSource) => void;
}) {
  const { draft, suggestions, canWriteMessages, canBrowseLibrary } = options;

  const onChange = (value: string) => {
    if (!canWriteMessages) return;
    if (FILES_SHORTCUT.test(value)) {
      draft.setText(value.replace(FILES_SHORTCUT, "$1"));
      suggestions.setOpen(false);
      if (options.canUploadAttachments && draft.attachmentSlotsLeft > 0)
        options.openPicker("files");
      return;
    }
    if (LIBRARY_SHORTCUT.test(value)) {
      draft.setText(value.replace(LIBRARY_SHORTCUT, "$1"));
      suggestions.setOpen(false);
      if (canBrowseLibrary) options.openPicker("library");
      return;
    }
    draft.setText(value);
    const match = value.match(TRAILING_MENTION);
    if (match) {
      if (canWriteMessages) suggestions.openAt(match[1]);
    } else {
      suggestions.close();
    }
  };

  const select = (suggestion: ChatComposerSuggestion) => {
    if (suggestion.kind === "library") {
      if (!canBrowseLibrary || draft.attachmentSlotsLeft === 0) return;
      draft.setSelectedLibraryIds((current) =>
        current.includes(suggestion.id) ? current : [...current, suggestion.id],
      );
      draft.setText((current) => current.replace(/(^|\s)@[^\s@]*$/, "$1"));
    } else {
      draft.setText((current) => current.replace(/(^|\s)@[^\s@]*$/, `$1@${suggestion.label} `));
      if (suggestion.kind === "agent") {
        draft.setSelectedAgentIdsByLabel((current) => ({
          ...current,
          [suggestion.label.toLocaleLowerCase()]: suggestion.id,
        }));
      }
    }
    suggestions.close();
  };

  /** Appends an `@` and opens the list, for the Mention button and starters. */
  const beginMention = () => {
    draft.setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@`);
    suggestions.openAt("");
  };

  return { onChange, select, beginMention };
}
