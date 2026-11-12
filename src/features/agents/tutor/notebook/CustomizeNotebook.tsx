import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  ChoiceGroup,
  Textarea,
} from "@/shared/ui";
import { useTutorStore } from "../tutorStore";
import type { Notebook, NotebookChatStyle } from "../tutorTypes";

const goals = [
  { value: "default", label: "Default" },
  { value: "guide", label: "Learning guide" },
  { value: "custom", label: "Custom" },
] as const;
const lengths = [
  { value: "default", label: "Default" },
  { value: "shorter", label: "Shorter" },
  { value: "longer", label: "Longer" },
] as const;

/** The first character a person sees in what they typed: one emoji, even one made of several. */
function firstGrapheme(text: string): string {
  // Intl.Segmenter is in every webview Misty runs in, but not in this project's TypeScript lib.
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale: undefined,
        options: { granularity: "grapheme" },
      ) => { segment(text: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  const trimmed = text.trim();
  if (!Segmenter) return Array.from(trimmed)[0] ?? "";
  const [first] = new Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  return first?.segment ?? "";
}

/**
 * A notebook's settings, after NotebookLM's: its cover emoji, how its chat answers (the default
 * way, as a learning guide, or as the person describes) and how long the answers are.
 */
export function CustomizeNotebook({
  notebook,
  open,
  onClose,
}: {
  notebook: Notebook;
  open: boolean;
  onClose(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} className="tutor-dialog">
        <DialogTitle>Customize notebook</DialogTitle>
        {/* Mounted only while open, so it starts from the notebook as it is now. */}
        {open && <CustomizeForm notebook={notebook} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CustomizeForm({ notebook, onClose }: { notebook: Notebook; onClose(): void }) {
  const [emoji, setEmoji] = useState(notebook.emoji ?? "");
  const [style, setStyle] = useState<NotebookChatStyle>(
    notebook.chatStyle ?? { goal: "default", length: "default" },
  );
  const save = () => {
    const cover = firstGrapheme(emoji);
    const custom = style.custom?.trim();
    const chatStyle: NotebookChatStyle | undefined =
      style.length === "default" &&
      (style.goal === "default" || (style.goal === "custom" && !custom))
        ? undefined
        : { ...style, custom: style.goal === "custom" ? custom : undefined };
    useTutorStore.getState().updateNotebook(notebook.id, (current) => ({
      ...current,
      emoji: cover || current.emoji,
      chatStyle,
    }));
    onClose();
  };
  return (
    <form
      className="tutor-customize"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="tutor-customize-group">
        <span>Cover emoji</span>
        <Input
          className="tutor-customize-emoji"
          aria-label="Cover emoji"
          placeholder="📓"
          value={emoji}
          onChange={(event) => setEmoji(event.target.value)}
        />
      </label>
      <div className="tutor-customize-group">
        <span>Conversational style</span>
        <ChoiceGroup
          label="Conversational style"
          value={style.goal}
          options={goals}
          onChange={(goal) => setStyle((current) => ({ ...current, goal }))}
        />
        {style.goal === "custom" && (
          <Textarea
            rows={4}
            autoFocus
            aria-label="How the chat should answer"
            placeholder="Answer like a patient teacher, and give an example for each idea"
            value={style.custom ?? ""}
            onChange={(event) =>
              setStyle((current) => ({ ...current, custom: event.target.value }))
            }
          />
        )}
      </div>
      <div className="tutor-customize-group">
        <span>Response length</span>
        <ChoiceGroup
          label="Response length"
          value={style.length}
          options={lengths}
          onChange={(length) => setStyle((current) => ({ ...current, length }))}
        />
      </div>
      <div className="tutor-customize-foot">
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
