import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SkeletonList,
  Spinner,
} from "@/shared/ui";
import { SettingsControlLabelContext } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { ExtensionIcon } from "./ExtensionIcon";
import { permissionLabel } from "./permissions";
import { storeNames } from "./store";
import type { ExtensionReview, Installation } from "./types";

/**
 * Reviews the access an extension requests before it is added. Opens while
 * Misty downloads and checks the package, with the review's shape as a skeleton.
 */
export function InstallReviewDialog({
  open,
  review,
  existing,
  busy,
  failure,
  privateAccess,
  onPrivateAccess,
  onRetry,
  onClose,
  onInstall,
}: {
  open: boolean;
  review: ExtensionReview | null;
  /** Already added: the review grants a new version's access instead. */
  existing: boolean;
  busy: boolean;
  failure: string;
  privateAccess: boolean;
  onPrivateAccess(value: boolean): void;
  onRetry?(): void;
  onClose(): void;
  onInstall(review: ExtensionReview): void;
}) {
  const name = review?.entry.name || "this extension";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-3">
            {review && (
              <span className="grid size-8 shrink-0 place-items-center [&_img]:size-8">
                <ExtensionIcon entry={review.entry} />
              </span>
            )}
            <span className="min-w-0 break-words">
              {review?.blocked
                ? `${name} can't run in Misty`
                : review
                  ? existing
                    ? `Review ${name}`
                    : `Add ${name}?`
                  : "Add extension"}
            </span>
          </DialogTitle>
          <DialogDescription>
            {review
              ? `${storeNames[review.entry.store]} · Version ${review.entry.version}. ` +
                "Review the access it asks for. Extensions you add sync to your Misty account."
              : "Misty downloads the extension from its store and checks its signature before you review it."}
          </DialogDescription>
        </DialogHeader>
        {!review && !failure && <SkeletonList label="Extension access" rows={3} lines={1} />}
        {!review && failure && (
          <>
            <p role="alert" className="text-sm">
              {failure}
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              {onRetry && <Button onClick={onRetry}>Try again</Button>}
            </DialogFooter>
          </>
        )}
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
                {busy ? <Spinner label="Adding extension" /> : existing ? "Allow" : "Add"}
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
          <DialogTitle>Remove {removing?.name}?</DialogTitle>
          <DialogDescription>
            This removes the extension and its saved settings from this device.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => removing && onUninstall(removing)}>
            Remove everywhere
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
