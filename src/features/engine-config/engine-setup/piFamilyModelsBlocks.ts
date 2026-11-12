// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): piFamilyModelsBlocks.ts.
// See NOTICE.

/**
 * One custom provider's block in Pi's models.json (JSONC) or Oh My Pi's models.yml, found in the
 * file's own text so it can be edited, renamed or removed while every comment, key order and
 * sibling provider stays as written.
 */
import { findJsonObjectProperty, readJsonString, skipJsonTrivia } from "./piFamilyJsonScan";

export type ModelsConfigFormat = "json" | "yaml";

export interface ProviderBlock {
  /** Character offset of the provider property in the original document. */
  start: number;
  /** Character offset just past the provider property value. */
  end: number;
  /** Exact source text that can be edited and spliced back. */
  text: string;
}

interface SourceLine {
  start: number;
  end: number;
  content: string;
}

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const raw = text.slice(start, end);
    lines.push({
      start,
      end,
      content: raw.endsWith("\r") ? raw.slice(0, -1) : raw,
    });
    if (newline === -1) {
      break;
    }
    start = newline + 1;
  }
  return lines;
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function yamlKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) {
    return null;
  }

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const closing = trimmed.indexOf(quote, 1);
    if (
      closing === -1 ||
      !trimmed
        .slice(closing + 1)
        .trimStart()
        .startsWith(":")
    ) {
      return null;
    }
    return trimmed.slice(1, closing);
  }

  const colon = trimmed.indexOf(":");
  return colon > 0 ? trimmed.slice(0, colon).trim() : null;
}

function extractYamlProviderBlock(text: string, providerId: string): ProviderBlock | null {
  const lines = sourceLines(text);
  let providersLine = -1;
  let providersIndent = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].content;
    if (isBlankOrComment(line)) {
      continue;
    }
    const key = yamlKey(line);
    if (key === "providers") {
      providersLine = index;
      providersIndent = indentation(line);
      break;
    }
  }
  if (providersLine < 0) {
    return null;
  }

  let providerIndent = -1;
  for (let index = providersLine + 1; index < lines.length; index += 1) {
    const line = lines[index].content;
    if (isBlankOrComment(line)) {
      continue;
    }
    const indent = indentation(line);
    if (indent <= providersIndent) {
      return null;
    }
    if (yamlKey(line)) {
      providerIndent = indent;
      break;
    }
  }
  if (providerIndent < 0) {
    return null;
  }

  let startLine = -1;
  let endLine = lines.length;
  for (let index = providersLine + 1; index < lines.length; index += 1) {
    const line = lines[index].content;
    if (line.trim().length === 0) {
      continue;
    }

    const indent = indentation(line);
    if (indent <= providersIndent) {
      if (startLine >= 0) {
        endLine = index;
      }
      break;
    }
    if (indent < providerIndent) {
      if (startLine >= 0) {
        endLine = index;
      }
      break;
    }
    if (indent !== providerIndent) {
      continue;
    }

    const key = yamlKey(line);
    if (!key) {
      if (startLine >= 0 && line.trimStart().startsWith("#")) {
        endLine = index;
        break;
      }
      continue;
    }
    if (startLine < 0) {
      if (key === providerId) {
        startLine = index;
      }
      continue;
    }
    endLine = index;
    break;
  }

  if (startLine < 0) {
    return null;
  }
  while (endLine > startLine + 1 && lines[endLine - 1].content.trim().length === 0) {
    endLine -= 1;
  }
  const endLineIndex = Math.max(startLine, endLine - 1);
  const start = lines[startLine].start;
  const end = lines[endLineIndex].end;
  return { start, end, text: text.slice(start, end) };
}

function extractJsonProviderBlock(text: string, providerId: string): ProviderBlock | null {
  const rootStart = skipJsonTrivia(text, 0);
  const providers = findJsonObjectProperty(text, rootStart, "providers");
  if (!providers) {
    return null;
  }
  const provider = findJsonObjectProperty(text, providers.valueStart, providerId);
  if (!provider) {
    return null;
  }
  return {
    start: provider.keyStart,
    end: provider.valueEnd,
    text: text.slice(provider.keyStart, provider.valueEnd),
  };
}

export function extractProviderBlock(
  text: string,
  format: ModelsConfigFormat,
  providerId: string,
): ProviderBlock | null {
  return format === "yaml"
    ? extractYamlProviderBlock(text, providerId)
    : extractJsonProviderBlock(text, providerId);
}

export function replaceProviderBlock(
  text: string,
  block: ProviderBlock,
  editedText: string,
): string {
  return `${text.slice(0, block.start)}${editedText}${text.slice(block.end)}`;
}

/** Provider-level fields the inline row editor can rewrite in place. */
export type EditableProviderField = "id" | "baseUrl";

/** YAML scalar for `value`: plain when it round-trips unambiguously, else a
 *  double-quoted JSON-style string (JSON escapes are valid YAML too). Plain
 *  keeps URLs readable (`https://host/v1` stays unquoted); quoting kicks in
 *  for the shapes that would otherwise re-parse differently — booleans/numbers,
 *  leading indicators, `: `/` #` sequences, edge whitespace, quotes, newlines. */
function yamlScalar(value: string): string {
  const plain =
    value.length > 0 &&
    !/^\s|\s$/.test(value) &&
    !/[\n\r\t"']/.test(value) &&
    !/^(true|false|null|~|yes|no|on|off)$/i.test(value) &&
    !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value) &&
    !/^(?:[-?:]\s|[{}[\]&*!|>%@`])/.test(value) &&
    !/[:#]\s|:$|\s#/.test(value);
  return plain ? value : JSON.stringify(value);
}

/** Rename the provider key in a YAML block (`  <id>:` → `  <newId>:`), leaving
 *  the body — comments, field order, nested model lists — untouched. */
function renameYamlProvider(block: ProviderBlock, newId: string): string {
  const keyLine = sourceLines(block.text)[0];
  const indent = " ".repeat(indentation(keyLine.content));
  return `${indent}${yamlScalar(newId)}:${block.text.slice(keyLine.start + keyLine.content.length)}`;
}

/** Set (or clear, when `value` is blank) one provider field inside its block,
 *  leaving every other line — including comments and blank lines — untouched.
 *  A missing field is appended right after the provider key / opening brace. */
function setYamlProviderField(block: ProviderBlock, field: string, value: string): string {
  const lines = sourceLines(block.text);
  const childIndent = indentation(lines[0].content) + 2;
  let fieldLine = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].content;
    if (isBlankOrComment(line) || indentation(line) !== childIndent) {
      continue;
    }
    if (yamlKey(line) === field) {
      fieldLine = index;
      break;
    }
  }

  if (value === "") {
    if (fieldLine < 0) {
      return block.text;
    }
    const line = lines[fieldLine];
    const end = line.end < block.text.length ? line.end + 1 : line.end;
    return `${block.text.slice(0, line.start)}${block.text.slice(end)}`;
  }

  const rendered = `${" ".repeat(childIndent)}${field}: ${yamlScalar(value)}`;
  if (fieldLine >= 0) {
    const line = lines[fieldLine];
    const contentEnd = line.start + line.content.length;
    return `${block.text.slice(0, line.start)}${rendered}${block.text.slice(contentEnd)}`;
  }
  const keyLine = lines[0];
  return `${block.text.slice(0, keyLine.end)}\n${rendered}${block.text.slice(keyLine.end)}`;
}

/** Drop one JSONC property, fixing the surrounding commas the same way
 *  `removeProviderBlock` does for whole providers. */
function removeJsonProperty(
  text: string,
  property: { keyStart: number; valueEnd: number },
): string {
  const nextSignificant = skipJsonTrivia(text, property.valueEnd);
  if (text[nextSignificant] === ",") {
    return `${text.slice(0, property.keyStart)}${text.slice(property.valueEnd, nextSignificant)}${text.slice(nextSignificant + 1)}`;
  }
  const before = text.slice(0, property.keyStart);
  const previousSignificant = before.trimEnd().length - 1;
  if (previousSignificant >= 0 && before[previousSignificant] === ",") {
    return `${text.slice(0, previousSignificant)}${text.slice(previousSignificant + 1, property.keyStart)}${text.slice(property.valueEnd)}`;
  }
  return `${text.slice(0, property.keyStart)}${text.slice(property.valueEnd)}`;
}

function setJsonProviderField(block: ProviderBlock, field: string, value: string): string {
  const key = readJsonString(block.text, 0);
  if (!key) {
    return block.text;
  }
  const colon = skipJsonTrivia(block.text, key.end);
  if (block.text[colon] !== ":") {
    return block.text;
  }
  const objectStart = skipJsonTrivia(block.text, colon + 1);
  const property = findJsonObjectProperty(block.text, objectStart, field);

  if (value === "") {
    return property ? removeJsonProperty(block.text, property) : block.text;
  }
  const rendered = `${JSON.stringify(field)}: ${JSON.stringify(value)}`;
  if (property) {
    return `${block.text.slice(0, property.valueStart)}${JSON.stringify(value)}${block.text.slice(property.valueEnd)}`;
  }
  const afterBrace = skipJsonTrivia(block.text, objectStart + 1);
  const separator = block.text[afterBrace] === "}" ? "" : ",";
  return `${block.text.slice(0, objectStart + 1)}${rendered}${separator}${block.text.slice(objectStart + 1)}`;
}

/** Rename the provider key in a JSONC block (`"<id>": { … }` → `"<newId>": { … }`),
 *  preserving the trivia between the key and the colon. */
function renameJsonProvider(block: ProviderBlock, newId: string): string {
  const key = readJsonString(block.text, 0);
  if (!key) {
    return block.text;
  }
  return `${JSON.stringify(newId)}${block.text.slice(key.end)}`;
}

/**
 * Rewrite one provider field in the raw config text, preserving comments, key
 * order and every sibling provider. `id` renames the provider key itself (the
 * provider display name IS its key — omp has no provider-level `name` field),
 * `baseUrl` sets or removes the endpoint. Returns the new text, or null when
 * the provider cannot be located; a blank `baseUrl` removes the field.
 */
export function setProviderField(
  text: string,
  format: ModelsConfigFormat,
  providerId: string,
  field: EditableProviderField,
  value: string,
): string | null {
  const block = extractProviderBlock(text, format, providerId);
  if (!block) {
    return null;
  }
  if (field === "id") {
    return replaceProviderBlock(
      text,
      block,
      format === "yaml" ? renameYamlProvider(block, value) : renameJsonProvider(block, value),
    );
  }
  const next =
    format === "yaml"
      ? setYamlProviderField(block, field, value)
      : setJsonProviderField(block, field, value);
  return replaceProviderBlock(text, block, next);
}

export function removeProviderBlock(
  text: string,
  block: ProviderBlock,
  format: ModelsConfigFormat,
): string {
  if (format === "yaml") {
    let suffixStart = block.end;
    if (text[suffixStart] === "\n") {
      suffixStart += 1;
    }
    return `${text.slice(0, block.start)}${text.slice(suffixStart)}`;
  }

  const nextSignificant = skipJsonTrivia(text, block.end);
  if (text[nextSignificant] === ",") {
    return `${text.slice(0, block.start)}${text.slice(block.end, nextSignificant)}${text.slice(nextSignificant + 1)}`;
  }

  const before = text.slice(0, block.start);
  const previousSignificant = before.trimEnd().length - 1;
  if (previousSignificant >= 0 && before[previousSignificant] === ",") {
    return `${text.slice(0, previousSignificant)}${text.slice(previousSignificant + 1, block.start)}${text.slice(block.end)}`;
  }
  return `${text.slice(0, block.start)}${text.slice(block.end)}`;
}
