import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorNotification,
  SkeletonList,
  Spinner,
} from "@/shared/ui";
import { SettingsControlLabelContext } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { ExtensionIcon } from "./ExtensionIcon";
import { accessLabels } from "./permissions";
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
  // A new version's review is about what's new; everything else was already approved here.
  const added = review ? [...review.addedPermissions, ...review.addedHosts] : [];
  const asked = review ? [...review.permissions, ...review.hosts] : [];
  const onlyNew = existing && added.length > 0;
  const access = accessLabels(onlyNew ? added : asked);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto">
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
        </DialogHeader>
        {!review && !failure && <SkeletonList label="Extension access" rows={3} lines={1} />}
        {!review && failure && (
          <>
            <ErrorNotification message={failure}>
              {onRetry && (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </ErrorNotification>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
        {review && (
          <>
            {access.length > 0 ? (
              <>
                <p className="text-sm">{onlyNew ? "It now also asks to:" : "It asks to:"}</p>
                <ul className="max-h-52 overflow-y-auto list-inside list-disc space-y-1 break-words text-sm">
                  {access.map(({ label, source }) => (
                    <li key={label} title={source}>
                      {label}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm">It doesn't ask for any access.</p>
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
              <p>
                {storeNames[review.entry.store]}, version {review.entry.version}.
              </p>
              {review.findings.map((finding) => (
                <p key={finding}>{finding}</p>
              ))}
            </div>
            <ErrorNotification message={failure} />
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
          <DialogDescription>Its saved settings are removed from this computer.</DialogDescription>
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
