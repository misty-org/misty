import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractMistyDocumentText } from "./mistyDocumentText";

const pack = (name: string, text: string) =>
  new JSZip().file(name, text).generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
describe("Word attachment text", () => {
  it("preserves paragraph order, tabs, and line breaks", async () => {
    await expect(
      extractMistyDocumentText(
        await pack(
          "word/document.xml",
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Launch</w:t><w:tab/><w:t>Friday</w:t><w:br/><w:t>Draft only</w:t></w:r></w:p><w:p><w:r><w:t>Second caption</w:t></w:r></w:p></w:body></w:document>`,
        ),
      ),
    ).resolves.toBe("Launch\tFriday\nDraft only\nSecond caption");
  });
  it("rejects oversized expansion and non-Word archives", async () => {
    await expect(
      extractMistyDocumentText(await pack("word/document.xml", "x".repeat(4 * 1024 * 1024 + 1))),
    ).rejects.toThrow("too large");
    await expect(extractMistyDocumentText(await pack("other.xml", "no"))).rejects.toThrow(
      "readable Word",
    );
  });
});
