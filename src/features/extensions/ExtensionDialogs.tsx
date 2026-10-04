import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui";
import { SettingsControlLabelContext } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { permissionLabel } from "./permissions";
import type { ExtensionReview, Installation } from "./types";

/** Reviews the access an extension requests before it installs. */
export function InstallReviewDialog({
  review,
  busy,
  failure,
  privateAccess,
  onPrivateAccess,
  onClose,
  onInstall,
}: {
  review: ExtensionReview | null;
  busy: boolean;
  failure: string;
  privateAccess: boolean;
  onPrivateAccess(value: boolean): void;
  onClose(): void;
  onInstall(review: ExtensionReview): void;
}) {
  return (
    <Dialog
      open={Boolean(review)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {review?.blocked
              ? "Extension unavailable"
              : `Install ${review?.entry.name ?? "extension"}?`}
          </DialogTitle>
          <DialogDescription>
            Review the access this extension requests. Installs and controls apply across your Misty
            account.
          </DialogDescription>
        </DialogHeader>
        {review && (
          <>
            <ul className="max-h-52 overflow-y-auto list-inside list-disc space-y-1 break-words text-sm">
              {[...review.permissions, ...review.hosts].map((permission) => (
                <li key={permission} title={permission}>
                  {permissionLabel(permission)}
                </li>
              ))}
            </ul>
            {!review.permissions.length && !review.hosts.length && (
              <p className="text-sm">No additional permissions requested.</p>
            )}
            <SettingsControlLabelContext.Provider value="Allow private tabs">
              <label className="flex items-center justify-between gap-3 text-sm">
                Allow private tabs
                <SwitchControl
                  checked={privateAccess}
                  disabled={!review.privateAllowed || busy}
                  onChange={onPrivateAccess}
                />
              </label>
            </SettingsControlLabelContext.Provider>
            <div className="space-y-2 text-sm text-cream-muted">
              {review.findings.map((finding) => (
                <p key={finding}>{finding}</p>
              ))}
            </div>
            {failure && (
              <p role="alert" className="text-sm">
                {failure}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={review.blocked || busy} onClick={() => onInstall(review)}>
                {busy ? "Installing…" : "Install"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UninstallDialog({
  removing,
  busy,
  onClose,
  onUninstall,
}: {
  removing: Installation | null;
  busy: boolean;
  onClose(): void;
  onUninstall(installation: Installation): void;
}) {
  return (
    <Dialog
      open={Boolean(removing)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Uninstall {removing?.name}?</DialogTitle>
          <DialogDescription>
            This removes the extension and its synced settings from your Misty account and connected
            devices.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => removing && onUninstall(removing)}>
            Uninstall everywhere
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
