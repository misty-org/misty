import { NotebookText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { Text, Textarea } from "@misty/ui";

/**
 * The speaker notes strip under the slide, bound to the slide's notes in the room. It grows as
 * you type; each edit is applied as the smallest change, so two people typing merge.
 */
export function NotesStrip(props: { notes: Y.Text | null; canEdit: boolean; slideNumber: number }) {
  const { notes } = props;
  const [value, setValue] = useState(() => notes?.toString() ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(notes?.toString() ?? "");
    if (!notes) return;
    const sync = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.local && transaction.origin === notesOrigin) return;
      const element = ref.current;
      const next = notes.toString();
      // Keep the caret where it was relative to the end when someone else edits.
      const fromEnd = element ? element.value.length - (element.selectionStart ?? 0) : 0;
      setValue(next);
      if (element && document.activeElement === element)
        requestAnimationFrame(() => {
          const at = Math.max(0, next.length - fromEnd);
          element.setSelectionRange(at, at);
        });
    };
    notes.observe(sync);
    return () => notes.unobserve(sync);
  }, [notes]);

  return (
    <div className="flex shrink-0 items-start gap-2.5 px-9 pt-2.5 pb-3.5">
      <Text bare tone="muted" className="pt-1">
        <NotebookText aria-hidden="true" />
      </Text>
      <Textarea
        ref={ref}
        variant="composer"
        aria-label={`Speaker notes for slide ${props.slideNumber}`}
        placeholder="Speaker notes"
        readOnly={!props.canEdit || !notes}
        rows={1}
        className="field-sizing-content max-h-40 text-meta"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          if (notes) applyTextChange(notes, value, next);
          setValue(next);
        }}
      />
    </div>
  );
}

const notesOrigin = { source: "misty-deck-notes" } as const;

/** Applies the change from `before` to `after` as one delete and one insert in the middle. */
export function applyTextChange(text: Y.Text, before: string, after: string): void {
  if (before === after) return;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  text.doc?.transact(() => {
    if (endBefore > start) text.delete(start, endBefore - start);
    if (endAfter > start) text.insert(start, after.slice(start, endAfter));
  }, notesOrigin);
}
