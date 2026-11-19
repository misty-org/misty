import { useRef } from "react";
import {
  Button,
  Popover,
  PopoverActions,
  PopoverAnchor,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  Textarea,
} from "@/shared/ui";
import type { TextDraft } from "./editorTypes";

/** The box text is written in: anchored where the text goes, Enter to add, Shift+Enter for a new line. */
export function TextBox(props: {
  draft: TextDraft | null;
  anchor: { x: number; y: number } | null;
  onChange: (draft: TextDraft | null) => void;
  onDone: (draft: TextDraft) => void;
}) {
  const { draft, anchor } = props;
  const escaped = useRef(false);
  return (
    <Popover
      open={Boolean(draft)}
      onOpenChange={(open) => {
        if (open || !draft) return;
        // Clicking away keeps what was written; Escape drops it.
        if (!escaped.current && draft.text.trim()) props.onDone(draft);
        else props.onChange(null);
        escaped.current = false;
      }}
    >
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-px"
          style={anchor ? { left: anchor.x, top: anchor.y } : undefined}
        />
      </PopoverAnchor>
      <PopoverContent
        size="md"
        side="bottom"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={() => {
          escaped.current = true;
        }}
      >
        {draft ? (
          <>
            <PopoverHeader title={draft.markId ? "Edit text" : "Add text"} />
            <PopoverBody>
              <Textarea
                aria-label="Text"
                autoFocus
                value={draft.text}
                rows={2}
                onChange={(event) => props.onChange({ ...draft, text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    props.onDone(draft);
                  }
                }}
              />
            </PopoverBody>
            <PopoverActions>
              <Button variant="quiet" onClick={() => props.onChange(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!draft.markId && !draft.text.trim()}
                onClick={() => props.onDone(draft)}
              >
                {draft.markId ? "Done" : "Add"}
              </Button>
            </PopoverActions>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
