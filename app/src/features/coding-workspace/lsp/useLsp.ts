import { LspClient } from "./client";

const clients = new Map<string, LspClient>();
const startupFailures = new Map<string, string>();

function keyFor(language: string, cwd: string): string {
  return `${language}::${cwd}`;
}

export function languageFor(filename: string): string | null {
  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "rs":
      return "rust";
    case "py":
      return "python";
    default:
      return null;
  }
}

export async function getLspClient(
  language: string,
  cwd: string,
): Promise<LspClient | null> {
  const key = keyFor(language, cwd);
  if (startupFailures.has(key)) return null;
  const existing = clients.get(key);
  if (existing) {
    try {
      await existing.ensureStarted();
      return existing;
    } catch (error) {
      startupFailures.set(key, error instanceof Error ? error.message : "LSP startup failed");
      clients.delete(key);
      return null;
    }
  }
  const client = new LspClient(language, cwd);
  clients.set(key, client);
  try {
    await client.ensureStarted();
    return client;
  } catch (error) {
    startupFailures.set(key, error instanceof Error ? error.message : "LSP startup failed");
    clients.delete(key);
    void client.dispose();
    return null;
  }
}

export function lastLspError(language: string, cwd: string): string | null {
  return startupFailures.get(keyFor(language, cwd)) ?? null;
}

export function forgetLspError(language: string, cwd: string): void {
  startupFailures.delete(keyFor(language, cwd));
}
