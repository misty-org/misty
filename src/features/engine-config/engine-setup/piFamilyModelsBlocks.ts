// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): piFamilyModelsBlocks.ts.
// See NOTICE.

/**
 * One custom provider's block in Pi's models.json (JSONC) or Oh My Pi's models.yml, found in the
 * file's own text so it can be edited, renamed or removed while every comment, key order and
 * sibling provider stays as written.
 */
import { findJsonObjectProperty, skipJsonTrivia } from "./piFamilyJsonScan";

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
