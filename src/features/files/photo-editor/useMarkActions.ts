import type { MarkStyle, TextDraft } from "./editorTypes";
import { newMarkId, topZ, type ImageEdit, type Mark } from "./imageEdit";
import { moveMark } from "./markGeometry";
import type { ImageDocument } from "./useImageDocument";

/**
 * What can be done to the marks picked in the image: restyle, fade, duplicate, delete, stack,
 * nudge and edit a text's words. Each is one change to the shared edit, undone in one step; a fade
 * follows its slider live and is kept as one step when it lets go.
 */
export function useMarkActions(options: {
  edit: ImageEdit;
  change: ImageDocument["change"];
  preview: ImageDocument["preview"];
  commit: ImageDocument["commit"];
  picked: string[];
  setPicked: (ids: string[]) => void;
  setStyle: (update: (current: MarkStyle) => MarkStyle) => void;
  setTextDraft: (draft: TextDraft | null) => void;
  author?: string;
}) {
  const { edit, change, picked, setPicked, author } = options;

  const restyle = (partial: Partial<MarkStyle>) => {
    options.setStyle((current) => ({ ...current, ...partial }));
    if (!picked.length) return;
    change((current) => {
      const marks = { ...current.marks };
      for (const id of picked) {
        const mark = marks[id];
        if (!mark) continue;
        let next: Mark = mark;
        if (partial.color && next.kind !== "redact") next = { ...next, color: partial.color };
        if (
          partial.stroke &&
          next.kind !== "text" &&
          next.kind !== "redact" &&
          next.kind !== "sticker"
        )
          next = { ...next, size: partial.stroke };
        if (partial.text && next.kind === "text") next = { ...next, size: partial.text };
        if (partial.fill !== undefined && (next.kind === "rect" || next.kind === "ellipse"))
          next = { ...next, fill: partial.fill };
        marks[id] = next;
      }
      return { ...current, marks };
    });
  };
  /** Sets the picked stickers' opacity, 0 to 1, as its slider moves. */
  const fade = (opacity: number) => {
    if (!picked.length) return;
    options.preview((current) => {
      const marks = { ...current.marks };
      for (const id of picked) {
        const mark = marks[id];
        if (mark?.kind === "sticker") marks[id] = { ...mark, opacity };
      }
      return { ...current, marks };
    });
  };
  const duplicate = () => {
    if (!picked.length) return;
    const ids: string[] = [];
    change((current) => {
      const marks = { ...current.marks };
      let z = topZ(current.marks);
      for (const id of picked) {
        const mark = current.marks[id];
        if (!mark) continue;
        const copy: Mark = { ...moveMark(mark, 0.02, 0.02), id: newMarkId(), z: ++z };
        if (author) copy.author = author;
        marks[copy.id] = copy;
        ids.push(copy.id);
      }
      return { ...current, marks };
    });
    setPicked(ids);
  };
  const remove = () => {
    if (!picked.length) return;
    change((current) => {
      const marks = { ...current.marks };
      for (const id of picked) delete marks[id];
      return { ...current, marks };
    });
    setPicked([]);
  };
  const arrange = (to: "front" | "back") =>
    change((current) => {
      const all = Object.values(current.marks);
      const marks = { ...current.marks };
      const stacked = picked
        .map((id) => marks[id])
        .filter(Boolean)
        .sort((a, b) => a.z - b.z);
      if (to === "front") {
        let z = Math.max(0, ...all.map((mark) => mark.z));
        for (const mark of stacked) marks[mark.id] = { ...mark, z: ++z };
      } else {
        let z = Math.min(0, ...all.map((mark) => mark.z)) - stacked.length;
        for (const mark of stacked) marks[mark.id] = { ...mark, z: z++ };
      }
      return { ...current, marks };
    });
  const editText = () => {
    const mark = picked.length === 1 ? edit.marks[picked[0]] : null;
    if (mark?.kind === "text")
      options.setTextDraft({ at: mark.at, markId: mark.id, text: mark.text });
  };
  const nudge = (dx: number, dy: number) =>
    change((current) => {
      const marks = { ...current.marks };
      for (const id of picked) if (marks[id]) marks[id] = moveMark(marks[id], dx, dy);
      return { ...current, marks };
    });

  return { restyle, fade, fadeDone: options.commit, duplicate, remove, arrange, editText, nudge };
}
