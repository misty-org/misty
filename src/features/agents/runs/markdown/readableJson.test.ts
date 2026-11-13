import { describe, expect, it } from "vitest";
import { readableJson } from "./readableJson";

describe("readableJson", () => {
  it("indents a reply that is only JSON", () => {
    expect(readableJson('{"title":"Light","scenes":[1,2]}')).toBe(
      '```json\n{\n  "title": "Light",\n  "scenes": [\n    1,\n    2\n  ]\n}\n```',
    );
  });

  it("indents a fenced JSON block and keeps the words around it", () => {
    const reply = 'Here it is:\n\n```json\n{"a":1}\n```\n\nDone.';
    expect(readableJson(reply)).toBe('Here it is:\n\n```json\n{\n  "a": 1\n}\n```\n\nDone.');
  });

  it("leaves other languages, broken JSON and plain text alone", () => {
    const code = '```ts\nconst a = {"b":1};\n```';
    expect(readableJson(code)).toBe(code);
    const broken = '```json\n{"a":\n```';
    expect(readableJson(broken)).toBe(broken);
    expect(readableJson("Just words.")).toBe("Just words.");
    expect(readableJson("42")).toBe("42");
  });
});
