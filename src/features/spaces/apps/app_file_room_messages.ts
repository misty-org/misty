const MAX_NONCE_LENGTH = 64;
const MAX_NAME_LENGTH = 255;
const MAX_FINGERPRINT_LENGTH = 128;

export const PAUSED_MESSAGE = "Keeping the changes beside the file, edits pause for a moment.";
export const REFUSED_MESSAGE = "The app tried to change Misty's own record of this file, so that change wasn't kept.";
export const LARGE_SAVE_NOTICE =
  "This file is larger than the size Misty syncs by itself, so the change stays on this computer until someone chooses to sync it.";

export function outsideNotice(readOnly: boolean, keptName: string | null): string {
  if (readOnly) return "This file was changed somewhere else. Open it again to see the newer version.";
  const said = "This file was changed somewhere else, so edits here aren't saved over it.";
  return keptName
    ? `${said} Your changes were kept in ${keptName}. Open it again to keep editing.`
    : `${said} Open it again to keep editing.`;
}

export interface FileRoomMessage {
  type: string;
  writer: boolean;
  dirty?: boolean;
  readOnly: boolean;
  loaded?: boolean;
  generation?: string;
  base?: number;
  hasWriter?: boolean;
  nonce?: string;
  outside: boolean;
  driveVersion?: number;
  fingerprint?: string;
  keptName?: string;
  keptFingerprint?: string;
  resolving?: number;
  version?: number;
  renamed?: number;
}

const versionOf = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

export function readFileRoomMessage(message: string): FileRoomMessage | null {
  let said: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(message);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    said = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof said.type !== "string") return null;
  const text = (value: unknown, most: number) =>
    typeof value === "string" && value.length > 0 && value.length <= most ? value : undefined;
  return {
    type: said.type,
    writer: said.writer === true,
    ...(typeof said.dirty === "boolean" ? { dirty: said.dirty } : {}),
    readOnly: said.read_only === true,
    ...(typeof said.loaded === "boolean" ? { loaded: said.loaded } : {}),
    ...(typeof said.generation === "string" && said.generation ? { generation: said.generation } : {}),
    base: versionOf(said.base),
    ...(typeof said.has_writer === "boolean" ? { hasWriter: said.has_writer } : {}),
    nonce: text(said.nonce, MAX_NONCE_LENGTH),
    outside: said.outside === true,
    driveVersion: versionOf(said.drive_version),
    ...(typeof said.fingerprint === "string" ? { fingerprint: said.fingerprint } : {}),
    keptName: text(said.kept_name, MAX_NAME_LENGTH),
    keptFingerprint: text(said.kept_fingerprint, MAX_FINGERPRINT_LENGTH),
    resolving: versionOf(said.resolving),
    version: versionOf(said.version),
    renamed: versionOf(said.renamed),
  };
}
