/**
 * JSX tags for the UI rules. A small scanner rather than a regex, because attribute values hold
 * arrows (`=>`), nested elements (`icon={<Mark />}`) and template strings that a `[^>]*` can't
 * step over.
 *
 * Runs under plain Node with uiRules.ts, so it imports nothing but Node itself.
 */

export interface JsxTag {
  name: string;
  /** Index of the `<` in the scanned text. */
  start: number;
  /** Index just past the closing `>`. */
  end: number;
  /** The tag as written. */
  raw: string;
  /**
   * The tag with the contents of every string and `{…}` expression blanked to spaces (the quotes
   * and braces stay), so attribute checks see only this tag's own attribute names, never a class
   * name or an element nested in a value. Indexes line up with `raw`.
   */
  flat: string;
  selfClosing: boolean;
}

const tagStart = /<([A-Za-z][\w.]*)(?=[\s/>])/g;

/** Index just past the string or template that opens at `from`. */
function skipQuoted(text: string, from: number): number {
  const quote = text[from];
  let index = from + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") index += 2;
    else if (char === quote) return index + 1;
    else if (quote === "`" && char === "$" && text[index + 1] === "{") {
      index = skipExpression(text, index + 1);
    } else index += 1;
  }
  return text.length;
}

/** Index just past the `}` that closes the `{` at `from`. */
function skipExpression(text: string, from: number): number {
  let depth = 0;
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(text, index);
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return text.length;
}

let scanned: { text: string; tags: JsxTag[] } | undefined;

/** Every JSX opening tag, outermost and nested alike, optionally only those named by `names`. */
export function jsxOpeningTags(text: string, names?: RegExp): JsxTag[] {
  // Several rules read the same file's tags; scan it once.
  if (scanned?.text !== text) scanned = { text, tags: scanTags(text) };
  return names ? scanned.tags.filter((tag) => names.test(tag.name)) : scanned.tags;
}

function scanTags(text: string): JsxTag[] {
  const tags: JsxTag[] = [];
  tagStart.lastIndex = 0;
  for (let match = tagStart.exec(text); match; match = tagStart.exec(text)) {
    const start = match.index;
    // `useState<Foo>` and `a<b` are TypeScript, not JSX: a tag never follows an identifier.
    if (start > 0 && /[\w$)\]]/.test(text[start - 1])) continue;
    const name = match[1];
    let index = start + match[0].length;
    let flat = text.slice(start, index);
    let end = -1;
    while (index < text.length && index - start < 8000) {
      const char = text[index];
      if (char === '"' || char === "'") {
        const next = skipQuoted(text, index);
        flat += `${char}${" ".repeat(Math.max(0, next - index - 2))}${text[next - 1]}`;
        index = next;
      } else if (char === "{") {
        const next = skipExpression(text, index);
        flat += `{${" ".repeat(Math.max(0, next - index - 2))}}`;
        index = next;
      } else if (char === ">") {
        end = index + 1;
        flat += ">";
        break;
      } else if (char === "<") {
        break;
      } else {
        flat += char;
        index += 1;
      }
    }
    if (end < 0) continue;
    const raw = text.slice(start, end);
    tags.push({ name, start, end, raw, flat, selfClosing: /\/\s*>$/.test(flat) });
  }
  return tags;
}

/** The raw value of a top-level attribute: `"ghost"`, `{cond ? "a" : "b"}`, or "" when bare. */
export function attributeValue(tag: JsxTag, attribute: string): string | undefined {
  const found = new RegExp(`\\s${attribute}(=?)`).exec(tag.flat);
  if (!found) return undefined;
  const after = tag.flat[found.index + found[0].length];
  if (found[1] !== "=" && after !== undefined && /[\w-]/.test(after)) return undefined;
  if (found[1] !== "=") return "";
  const from = found.index + found[0].length;
  const open = tag.flat[from];
  if (open === '"' || open === "'") return tag.raw.slice(from, skipQuoted(tag.raw, from));
  if (open === "{") return tag.raw.slice(from, tag.flat.indexOf("}", from + 1) + 1);
  return undefined;
}

/** The string literals an attribute value can take: `"ghost"` → ghost, `{a ? "x" : "y"}` → x, y. */
export function literalValues(value: string | undefined): string[] {
  if (value === undefined) return [];
  return [...value.matchAll(/["'`]([\w-]+)["'`]/g)].map((match) => match[1]);
}

export function hasAttribute(tag: JsxTag, attribute: string): boolean {
  return attributeValue(tag, attribute) !== undefined;
}

/** A spread such as `{...props}` may carry any attribute, so attribute-absence rules skip it. */
export function spreadsProps(tag: JsxTag): boolean {
  for (let index = tag.flat.indexOf("{"); index >= 0; index = tag.flat.indexOf("{", index + 1)) {
    if (/=\s*$/.test(tag.flat.slice(0, index))) continue;
    if (/^\{\s*\.\.\./.test(tag.raw.slice(index))) return true;
  }
  return false;
}

export function countTags(text: string, names: RegExp, test: (tag: JsxTag) => boolean): number {
  return jsxOpeningTags(text, names).filter(test).length;
}
