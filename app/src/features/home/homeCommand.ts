export type HomeCommand =
  | { kind: "url"; url: string }
  | { kind: "path"; path: string }
  | { kind: "ask"; query: string }
  | { kind: "search"; query: string };

/**
 * Decides what typing something into Home should do.
 *
 * Home is the tab you land on with an intention and nowhere to put it. Rather
 * than making people pick a tool first, the input reads the intent from the
 * shape of what they typed.
 */
export function parseHomeCommand(input: string): HomeCommand | null {
  const value = input.trim();
  if (!value) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return { kind: "url", url: value };
  if (value.startsWith("/") || value.startsWith("~/") || value === "~")
    return { kind: "path", path: value };
  // A bare host — "github.com", "localhost:5173" — but not a sentence. Any
  // other single word with a port would catch things like "note:todo", so
  // localhost is the one dotless host allowed through.
  const bareHost = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/;
  const localhost = /^localhost(:\d+)?(\/\S*)?$/i;
  if (!/\s/.test(value) && (bareHost.test(value) || localhost.test(value)))
    return { kind: "url", url: `https://${value}` };
  if (value.endsWith("?")) return { kind: "ask", query: value };
  return { kind: "search", query: value };
}
