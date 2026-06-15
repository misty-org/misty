import type { OfficialApp, UserAppInstallation } from "@/api/apps";

export function officialAppNeedsReview(
  app: OfficialApp,
  installation: UserAppInstallation | undefined,
): boolean {
  return Boolean(
    installation?.state === "installed" &&
    (installation.installed_version !== app.version ||
      installation.permission_version !== app.permission_version),
  );
}
