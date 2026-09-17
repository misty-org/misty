import { strFromU8, unzipSync } from "fflate";

/** Bounded text extraction for supplied DOCX attachments, without shipping a document editor. */
export function extractMistyDocumentText(bytes: ArrayBuffer): string {
  let tooLarge = false;
  const entries = unzipSync(new Uint8Array(bytes), {
    filter(file) {
      if (file.name !== "word/document.xml") return false;
      tooLarge = file.originalSize > 4 * 1024 * 1024;
      return !tooLarge;
    },
  });
  if (tooLarge)
    throw new Error("This Word document is too large to inspect. Attach a smaller section.");
  const body = entries["word/document.xml"];
  if (!body) throw new Error("This file does not contain a readable Word document.");
  const document = new DOMParser().parseFromString(strFromU8(body), "application/xml");
  if (document.querySelector("parsererror"))
    throw new Error("The Word document could not be read.");
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return Array.from(document.getElementsByTagNameNS(ns, "p"), (paragraph) =>
    Array.from(paragraph.getElementsByTagNameNS(ns, "*"), (node) =>
      node.localName === "t"
        ? (node.textContent ?? "")
        : node.localName === "tab"
          ? "\t"
          : node.localName === "br"
            ? "\n"
            : "",
    ).join(""),
  ).join("\n");
}
