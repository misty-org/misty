/**
 * Engines often answer with JSON on one line (Tutor's runs ask for it, and tool-minded CLIs reply
 * that way), which reads as a wall. A reply that is only JSON, and a fenced block holding JSON,
 * are shown indented. Anything that doesn't parse is left as written.
 */

const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n\1\2[ \t]*$/gm;

/** `source` indented when it is a JSON object or array, else undefined. */
export function indentedJson(source: string): string | undefined {
  const text = source.trim();
  if (!/^[[{]/.test(text)) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object") return undefined;
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

export function readableJson(reply: string): string {
  const whole = indentedJson(reply);
  if (whole) return "```json\n" + whole + "\n```";
  return reply.replace(fence, (block, indent: string, marks: string, language: string, body) => {
    if (language && !/^(json|jsonc|json5)$/i.test(language)) return block;
    const pretty = indentedJson(body);
    if (!pretty || pretty === body.trim()) return block;
    const lines = pretty.split("\n").map((line) => indent + line);
    return `${indent}${marks}${language || "json"}\n${lines.join("\n")}\n${indent}${marks}`;
  });
}
