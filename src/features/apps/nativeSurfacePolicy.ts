import type { OfficialApp, OfficialAppSession } from "@/api/apps";

export const nativeSurfaceScopes = {
  browser: ["browser.navigate"],
  files: ["files.read", "files.write"],
  code: ["code.read", "code.write"],
  terminal: ["terminal.execute"],
} as const;

export type NativeSurfaceId = keyof typeof nativeSurfaceScopes;

export function isNativeSurfaceId(value: string): value is NativeSurfaceId {
  return Object.prototype.hasOwnProperty.call(nativeSurfaceScopes, value);
}

export function grantedNativeSurface(
  app: OfficialApp,
  session: OfficialAppSession,
): NativeSurfaceId | null {
  const id = app.id;
  return app.official &&
    isNativeSurfaceId(id) &&
    session.app_id === id &&
    nativeSurfaceScopes[id].every(
      (scope) => app.scopes.includes(scope) && session.scopes.includes(scope),
    )
    ? id
    : null;
}
