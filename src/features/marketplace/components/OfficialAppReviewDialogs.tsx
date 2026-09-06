import type { OfficialApp, UserAppInstallation } from "@/api/apps";
import { officialAppNeedsReview } from "@/features/apps/appInstallationStatus";
import { appPermissionLabel } from "@/features/apps/appPermissions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";

export function OfficialAppReviewDialogs(props: {
  installApp: OfficialApp | null;
  installAppState?: UserAppInstallation;
  uninstallApp: OfficialApp | null;
  onCloseInstall: () => void;
  onCloseUninstall: () => void;
  onInstall: (app: OfficialApp) => void;
  onUninstall: (app: OfficialApp) => void;
}) {
  const action = props.installApp
    ? officialActionLabel(props.installApp, props.installAppState)
    : "Add";
  return (
    <>
      <AlertDialog
        open={Boolean(props.installApp)}
        onOpenChange={(open) => !open && props.onCloseInstall()}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {props.installApp ? `${action} ${props.installApp.name}?` : "Add App?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {props.installApp?.mobile.runtime === "unsupported"
                ? "This official Misty app will be available on compatible desktop devices signed into your account. It can:"
                : "This official Misty app will be available on your compatible signed-in devices. It can:"}
            </AlertDialogDescription>
            <ul className="grid gap-2 pt-1 text-sm leading-5 text-cream-muted">
              {props.installApp?.scopes.map((scope) => (
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
              onClick={() => props.installApp && props.onInstall(props.installApp)}
            >
              {action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(props.uninstallApp)}
        onOpenChange={(open) => !open && props.onCloseUninstall()}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {props.uninstallApp?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="leading-5">
              The app will disappear from this device and your other signed-in devices now. Your
              private app data can be recovered for 30 days, then it will be permanently deleted.
              Content shared with a Space will remain in that Space.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => props.uninstallApp && props.onUninstall(props.uninstallApp)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function officialActionLabel(
  app: OfficialApp,
  installation: UserAppInstallation | undefined,
): "Add" | "Review update" {
  if (installation?.state === "recoverable") return "Add";
  if (officialAppNeedsReview(app, installation)) return "Review update";
  return "Add";
}
