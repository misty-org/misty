import type { OfficialApp, UserAppInstallation } from "@/api/apps";

export function officialAppNeedsReview(
  app: OfficialApp,
  installation: UserAppInstallation | undefined,
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
  installation?: UserAppInstallation,
): boolean {
  return (
    installation?.state !== "installed" ||
    app.scopes.some((scope) => !installation.granted_scopes.includes(scope))
  );
}
