// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): piFamilyModelsBlocks.ts.
// See NOTICE.

/** Reading JSONC text by hand, so a provider's block can be found without reformatting the file. */

export function skipJsonTrivia(text: string, start: number): number {
  let index = start;
  for (;;) {
    while (index < text.length && /\s/.test(text[index])) {
      index += 1;
    }
    if (text[index] === "/" && text[index + 1] === "/") {
      const newline = text.indexOf("\n", index + 2);
      index = newline < 0 ? text.length : newline + 1;
      continue;
    }
    if (text[index] === "/" && text[index + 1] === "*") {
      const closing = text.indexOf("*/", index + 2);
      index = closing < 0 ? text.length : closing + 2;
      continue;
    }
    return index;
  }
}

export function readJsonString(text: string, start: number): { value: string; end: number } | null {
  if (text[start] !== '"') {
    return null;
  }
  let value = "";
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      return { value, end: index + 1 };
    }
    if (character !== "\\") {
      value += character;
      index += 1;
      continue;
    }

    const escaped = text[index + 1];
    if (escaped === "u") {
      const hex = text.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        return null;
      }
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 6;
      continue;
    }
    const decoded: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    value += decoded[escaped] ?? escaped ?? "";
    index += 2;
  }
  return null;
}

export function skipJsonValue(text: string, start: number): number | null {
  const first = text[start];
  if (first === '"') {
    return readJsonString(text, start)?.end ?? null;
  }
  if (first !== "{" && first !== "[") {
    let index = start;
    while (index < text.length && !/[\s,}\]]/.test(text[index])) {
      index += 1;
    }
    return index > start ? index : null;
  }

  const stack: string[] = [first === "{" ? "}" : "]"];
  let index = start + 1;
  while (index < text.length) {
    index = skipJsonTrivia(text, index);
    const character = text[index];
    if (character === '"') {
      const string = readJsonString(text, index);
      if (!string) {
        return null;
      }
      index = string.end;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character === "{" ? "}" : "]");
      index += 1;
      continue;
    }
    if (character === stack[stack.length - 1]) {
      stack.pop();
      index += 1;
      if (stack.length === 0) {
        return index;
      }
      continue;
    }
    index += 1;
  }
  return null;
}

export function findJsonObjectProperty(
  text: string,
  objectStart: number,
  property: string,
): { keyStart: number; valueStart: number; valueEnd: number } | null {
  if (text[objectStart] !== "{") {
    return null;
  }
  let index = skipJsonTrivia(text, objectStart + 1);
  while (index < text.length && text[index] !== "}") {
    const keyStart = index;
    const key = readJsonString(text, keyStart);
    if (!key) {
      return null;
    }
    index = skipJsonTrivia(text, key.end);
    if (text[index] !== ":") {
      return null;
    }
    const valueStart = skipJsonTrivia(text, index + 1);
    const valueEnd = skipJsonValue(text, valueStart);
    if (valueEnd === null) {
      return null;
    }
    if (key.value === property) {
      return { keyStart, valueStart, valueEnd };
    }
    index = skipJsonTrivia(text, valueEnd);
    if (text[index] === ",") {
      index = skipJsonTrivia(text, index + 1);
      continue;
    }
    if (text[index] !== "}") {
      return null;
    }
  }
  return null;
}
