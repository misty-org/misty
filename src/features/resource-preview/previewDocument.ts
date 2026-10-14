import { documentXmlFile, naturalPathSort, rtfToText, xmlToText } from "./previewFormat";
export async function extractDocumentText(extension: string, bytes: Uint8Array): Promise<string> {
  if (extension === "docx") {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({
      arrayBuffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    });
    return result.value.trim();
  }
  if (extension === "rtf") return rtfToText(new TextDecoder("latin1").decode(bytes));
  if (extension === "doc" || extension === "xls" || extension === "ppt")
    return "This legacy Office file can be opened in its default application. Save it as DOCX, XLSX, or PPTX for an inline text reader.";
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((name) => documentXmlFile(extension, name))
    .sort(naturalPathSort);
  const chunks: string[] = [];
  for (const name of names.slice(0, 300)) {
    const xml = await zip.files[name].async("text");
    const text = xmlToText(xml);
    if (text) chunks.push(text);
  }
  return chunks.join("\n\n").trim();
}
