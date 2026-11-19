import * as Y from "yjs";

/*
 * What a version holds, read from its Yjs state with each kind's layout
 * (space-artifacts-contract.md), for the history dialog's preview.
 */

/** The doc state a version's update makes. */
export function versionDoc(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
}

/** The text in a Yjs XML tree, one line per block. */
export function xmlText(node: Y.XmlFragment | Y.XmlElement): string {
  const lines: string[] = [];
  let line = "";
  const visit = (current: Y.XmlFragment | Y.XmlElement | Y.XmlText) => {
    if (current instanceof Y.XmlText) {
      for (const op of current.toDelta() as Array<{ insert?: unknown }>) {
        if (typeof op.insert === "string") line += op.insert;
      }
      return;
    }
    const children = current.toArray() as Array<Y.XmlElement | Y.XmlText>;
    const textblock = children.some((child) => child instanceof Y.XmlText);
    for (const child of children) visit(child);
    if (textblock || (current instanceof Y.XmlElement && children.length === 0)) {
      lines.push(line);
      line = "";
    }
  };
  visit(node);
  if (line) lines.push(line);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A doc version: its title and its text. */
export function summarizeNoteVersion(doc: Y.Doc): { title: string; text: string } {
  const fragment = doc.getXmlFragment("tiptap");
  const text = fragment.length
    ? xmlText(fragment)
    : doc.getText("misty:markdown").toString().trim();
  return { title: doc.getText("misty:title").toString().trim(), text };
}

/** A deck version: its title and its slides' titles, in order. */
export function summarizeDeckVersion(doc: Y.Doc): { title: string; slides: string[] } {
  const meta = doc.getMap<unknown>("deck:meta");
  const slides = doc.getMap<Y.Map<unknown>>("deck:slides");
  const order = doc.getArray<string>("deck:order").toArray();
  const titles = order.map((id) => {
    const slide = slides.get(id);
    const slots = slide instanceof Y.Map ? slide.get("slots") : undefined;
    if (!(slots instanceof Y.Map)) return "";
    for (const name of ["title", "quote", "number", "kicker"]) {
      const slot = slots.get(name);
      if (slot instanceof Y.XmlFragment) {
        const text = xmlText(slot).replace(/\s+/g, " ").trim();
        if (text) return text;
      }
    }
    return "";
  });
  return { title: String(meta.get("title") ?? "").trim(), slides: titles };
}

/** A workbook version: its title, its sheets' names in order and how many charts it has. */
export function summarizeWorkbookVersion(doc: Y.Doc): {
  title: string;
  sheets: string[];
  charts: number;
} {
  const meta = doc.getMap<unknown>("wb:meta");
  const sheets = doc.getMap<Y.Map<unknown>>("wb:sheets");
  const order = doc.getArray<string>("wb:sheetOrder").toArray();
  const ids = order.length ? order : [...sheets.keys()];
  return {
    title: String(meta.get("title") ?? "").trim(),
    sheets: ids.map((id) => {
      const sheet = sheets.get(id);
      const name = sheet instanceof Y.Map ? sheet.get("name") : undefined;
      return typeof name === "string" && name.trim() ? name.trim() : "Sheet";
    }),
    charts: doc.getMap("wb:charts").size,
  };
}
