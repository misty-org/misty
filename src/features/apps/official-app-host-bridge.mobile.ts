export interface OfficialAppNativeAccess {
  readonly folders: Set<string>;
  readonly files: Set<string>;
  readonly terminalSessions: Set<string>;
}

export function createOfficialAppNativeAccess(): OfficialAppNativeAccess {
  return { folders: new Set(), files: new Set(), terminalSessions: new Set() };
}

export async function respondToOfficialAppCommand(
  _event: MessageEvent,
  _appId: string,
  _scopes: readonly string[],
  _access: OfficialAppNativeAccess,
): Promise<void> {}

export async function closeOfficialAppNativeAccess(
  _appId: string,
  _access: OfficialAppNativeAccess,
): Promise<void> {}
