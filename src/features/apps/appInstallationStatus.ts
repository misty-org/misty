import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";

export function officialAppNeedsReview(
  app: OfficialApp,
  installation: SpaceAppInstallation | undefined,
): boolean {
  return Boolean(
    installation?.state === "installed" &&
    (installation.installed_version !== app.version ||
      installation.permission_version !== app.permission_version ||
      (app.scopes ?? []).some((scope) => !installation.granted_scopes.includes(scope))),
  );
}

export function officialAppNeedsConsent(
  app: OfficialApp,
  installation?: SpaceAppInstallation,
): boolean {
  return (
    installation?.state !== "installed" ||
    app.scopes.some((scope) => !installation.granted_scopes.includes(scope))
  );
}
