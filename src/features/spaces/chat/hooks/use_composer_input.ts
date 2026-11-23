import type { MistyPickerSource } from "@/features/files";
import type { ChatComposerSuggestion } from "../../api/dto/space_chat";
import type { ChatSuggestionsState } from "./use_chat_suggestions";
import type { SpaceChatDraft } from "../composer/use_space_chat_draft";

const FILES_SHORTCUT = /(^|\s)@files\s*$/i;
const TRAILING_MENTION = /(?:^|\s)@([^\s@]*)$/;

export function useComposerInput(options: {
  draft: SpaceChatDraft;
  suggestions: ChatSuggestionsState;
  canWriteMessages: boolean;
  canUploadAttachments: boolean;
  openPicker: (source: MistyPickerSource) => void;
}) {
  const { draft, suggestions, canWriteMessages } = options;

  const onChange = (value: string) => {
    if (!canWriteMessages) return;
    if (FILES_SHORTCUT.test(value)) {
      draft.setText(value.replace(FILES_SHORTCUT, "$1"));
      suggestions.setOpen(false);
      if (options.canUploadAttachments && draft.attachmentSlotsLeft > 0)
        options.openPicker("files");
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
    draft.setText((current) => current.replace(/(^|\s)@[^\s@]*$/, `$1@${suggestion.label} `));
    suggestions.close();
  };

  const beginMention = () => {
    draft.setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@`);
    suggestions.openAt("");
  };

  return { onChange, select, beginMention };
}
