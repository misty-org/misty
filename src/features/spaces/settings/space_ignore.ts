import { driveNative, type DriveEntry } from "../drive";

const IGNORE_FILE = ".mistyignore";
const IGNORE_PATH = `/${IGNORE_FILE}`;
const IGNORE_READ_LIMIT = 256 * 1024;

export interface SpaceIgnore {
  entry: DriveEntry | null;
  text: string;
}

export function ignoreRules(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

export function withRule(text: string, rule: string): string {
  if (ignoreRules(text).includes(rule)) return text;
  const lead = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${lead}${rule}\n`;
}

export function withoutRule(text: string, rule: string): string {
  return text
    .split(/(?<=\n)/)
    .filter((line) => line.trim() !== rule)
    .join("");
}

export async function readSpaceIgnore(spaceId: string): Promise<SpaceIgnore> {
  const entry = await driveNative.entry(spaceId, IGNORE_PATH);
  if (!entry || entry.kind !== "file") return { entry: null, text: "" };
  const bytes = await driveNative.read(spaceId, IGNORE_PATH, IGNORE_READ_LIMIT);
  return { entry, text: new TextDecoder().decode(bytes) };
}

export async function writeSpaceIgnore(
  spaceId: string,
  current: SpaceIgnore,
  text: string,
): Promise<SpaceIgnore> {
  const entry = await driveNative.write(
    spaceId,
    "/",
    IGNORE_FILE,
    new TextEncoder().encode(text),
    current.entry ? { item_id: current.entry.id, version: current.entry.version ?? 0 } : undefined,
  );
  return { entry, text };
}
