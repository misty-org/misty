import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractMistyDocumentText } from "./mistyDocumentText";

const pack = (text: string) =>
  zipSync({ "word/document.xml": new Uint8Array(strToU8(text)) }).buffer as ArrayBuffer;
describe("Word attachment text", () => {
  it("preserves paragraph order, tabs, and line breaks", () => {
    expect(
      extractMistyDocumentText(
        pack(
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Launch</w:t><w:tab/><w:t>Friday</w:t><w:br/><w:t>Draft only</w:t></w:r></w:p><w:p><w:r><w:t>Second caption</w:t></w:r></w:p></w:body></w:document>`,
        ),
      ),
    ).toBe("Launch\tFriday\nDraft only\nSecond caption");
  });
  it("rejects oversized expansion and non-Word archives", () => {
    expect(() => extractMistyDocumentText(pack("x".repeat(4 * 1024 * 1024 + 1)))).toThrow(
      "too large",
    );
    expect(() =>
      extractMistyDocumentText(
        zipSync({ "other.xml": new Uint8Array(strToU8("no")) }).buffer as ArrayBuffer,
      ),
    ).toThrow("readable Word");
  });
});
