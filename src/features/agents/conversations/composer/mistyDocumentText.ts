import JSZip from "jszip";

const maxExpandedBytes = 4 * 1024 * 1024;

/** JSZip's own stream, missing from its types. It lets a read stop as soon as it's too large. */
interface EntryStream {
  on(event: "data", listener: (chunk: Uint8Array) => void): EntryStream;
  on(event: "error", listener: (error: Error) => void): EntryStream;
  on(event: "end", listener: () => void): EntryStream;
  pause(): EntryStream;
  resume(): EntryStream;
}

/** Reads one entry, giving up past the limit, so a small archive can't expand without bound. */
function readBounded(entry: JSZip.JSZipObject): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    const stream = (
      entry as unknown as { internalStream(type: "uint8array"): EntryStream }
    ).internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        size += chunk.length;
        if (size > maxExpandedBytes) {
          stream.pause();
          reject(
            new Error("This Word document is too large to inspect. Attach a smaller section."),
          );
          return;
        }
        text += decoder.decode(chunk, { stream: true });
      })
      .on("error", reject)
      .on("end", () => resolve(text + decoder.decode()))
      .resume();
  });
}

/** Bounded text extraction for supplied DOCX attachments, without shipping a document editor. */
export async function extractMistyDocumentText(bytes: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("This file does not contain a readable Word document.");
  const document = new DOMParser().parseFromString(await readBounded(entry), "application/xml");
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
