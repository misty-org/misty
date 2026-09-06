import type { OfficialApp, UserAppInstallation } from "@/api/apps";
import { useAuth } from "@/features/auth";
import { preferredDefaultSpace, useSpacesStore } from "@/features/spaces/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Separator,
} from "@/shared/ui";
import { useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { officialAppRoute } from "./appRoute";
import { officialAppNeedsReview } from "./appInstallationStatus";
import { OfficialAppIcon } from "./OfficialAppIcon";
import { appPermissionLabel } from "./appPermissions";
import { useAppsStore } from "./useAppsStore";

export function MobileStorePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const activeSpace = preferredDefaultSpace(spaces);
  const catalog = useAppsStore((state) => state.catalog);
  const installations = useAppsStore((state) => state.installations);
  const actionAppId = useAppsStore((state) => state.actionAppId);
  const error = useAppsStore((state) => state.error);
  const install = useAppsStore((state) => state.install);
  const uninstall = useAppsStore((state) => state.uninstall);
  const [uninstalling, setUninstalling] = useState<OfficialApp | null>(null);
  const [installing, setInstalling] = useState<OfficialApp | null>(null);
  const mobileApps = catalog.filter((app) => app.mobile.runtime !== "unsupported");
  const desktopApps = catalog.filter((app) => app.mobile.runtime === "unsupported");
  const installationById = useMemo(
    () => new Map(installations.map((item) => [item.app_id, item])),
    [installations],
  );

  const openApp = (app: OfficialApp) =>
    navigate(officialAppRoute(app.id, activeSpace?.id, user?.id ?? ""));

  return (
    <div className="misty-transient-scrollbar h-full overflow-y-auto bg-charcoal-bg">
      <div className="mx-auto w-full max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
        <p className="mb-4 text-sm text-cream-muted">Official apps from Misty.</p>
        {error ? (
          <p className="mb-3 rounded-md border border-notification-red/40 px-3 py-2 text-sm text-cream">
            {error}
          </p>
        ) : null}
        <section
          className="overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card/30"
          aria-label="Apps for iPhone and iPad"
        >
          {mobileApps.map((app, index) => {
            const installation = installationById.get(app.id);
            const installed = installation?.state === "installed";
            const recoverable = installation?.state === "recoverable";
            const updateAvailable = officialAppNeedsReview(app, installation);
            return (
              <div key={app.id}>
                {index ? <Separator /> : null}
                <div className="flex min-h-[76px] items-center gap-3 px-3 py-2.5">
                  <OfficialAppIcon appId={app.id} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-cream-bright">
                      {app.name}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs leading-4 text-cream-muted">
                      {recoverable ? recoveryCopy(installation?.data_deletion_at) : app.description}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      className="min-w-[72px]"
                      disabled={Boolean(actionAppId)}
                      size="sm"
                      variant={installed ? "outline" : "default"}
                      onClick={() =>
                        installed && !updateAvailable ? openApp(app) : setInstalling(app)
                      }
                    >
                      {actionAppId === app.id
                        ? "Working…"
                        : updateAvailable
                          ? "Update"
                          : installed
                            ? "Open"
                            : recoverable
                              ? "Restore"
                              : "Add"}
                    </Button>
                    {installed ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${app.name}`}
                        onClick={() => setUninstalling(app)}
                      >
                        <MoreHorizontal size={18} aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <section className="mt-7" aria-label="Desktop-only apps">
          <h2 className="mb-2 text-sm font-medium text-cream">Desktop apps</h2>
          <div className="overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card/20">
            {desktopApps.map((app, index) => (
              <div key={app.id}>
                {index ? <Separator /> : null}
                <div className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <OfficialAppIcon appId={app.id} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-cream-muted">{app.name}</span>
                    <span className="block text-xs text-cream-muted">Available on desktop</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <AlertDialog open={Boolean(installing)} onOpenChange={(open) => !open && setInstalling(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {installing ? mobileInstallAction(installationById.get(installing.id)) : "Add"}{" "}
              {installing?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This official Misty app will be available on every signed-in device. It can:
            </AlertDialogDescription>
            <ul className="grid gap-2 pt-1 text-left text-sm leading-5 text-cream-muted">
              {installing?.scopes.map((scope) => (
                <li className="flex gap-2" key={scope}>
                  <span aria-hidden="true">•</span>
                  <span>{appPermissionLabel(scope)}</span>
                </li>
              ))}
            </ul>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const app = installing;
                setInstalling(null);
                if (app) void install(app).catch(() => undefined);
              }}
            >
              {installing ? mobileInstallAction(installationById.get(installing.id)) : "Add"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(uninstalling)}
        onOpenChange={(open) => !open && setUninstalling(null)}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {uninstalling?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="leading-5">
              The app will disappear now. Your private app data can be recovered until{" "}
              {prospectiveDeletionDate()}, then it will be permanently deleted. Content shared with
              a Space will remain in that Space.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (uninstalling) void uninstall(uninstalling.id).catch(() => undefined);
                setUninstalling(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function recoveryCopy(value: string | undefined) {
  if (!value) return "Restore the App to recover your private data.";
  return `Data recoverable until ${new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" })}.`;
}

function prospectiveDeletionDate() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, {
    dateStyle: "long",
  });
}

function mobileInstallAction(installation: UserAppInstallation | undefined) {
  if (installation?.state === "recoverable") return "Restore";
  if (installation?.state === "installed") return "Update";
  return "Add";
}
