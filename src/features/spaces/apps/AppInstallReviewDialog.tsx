import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Text,
} from "@misty/ui";
import { permissionLines } from "./appPermissions";
import type { CatalogApp } from "./thirdPartyApps";

export function AppInstallReviewDialog({
  app,
  saving,
  failure,
  onOpenChange,
  onApprove,
}: {
  app: CatalogApp | null;
  saving: boolean;
  failure: string;
  onOpenChange(open: boolean): void;
  onApprove(): void;
}) {
  return (
    <Dialog open={Boolean(app)} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-xl">
        {app ? (
          <>
            <DialogHeader>
              <DialogTitle>{`Add ${app.name}`}</DialogTitle>
            </DialogHeader>
            <Text as="p" wrap className="mt-4">
              {`${app.name}, by ${app.maker}, will be able to:`}
            </Text>
            <ul className="mt-3 grid gap-1">
              {app.permissions.map((permission) => (
                <li key={permission}>
                  <Text tone="muted" wrap>
                    {permissionLines[permission] ?? permission}
                  </Text>
                </li>
              ))}
            </ul>
            {failure ? (
              <Text as="p" tone="danger" wrap role="alert" className="mt-3">
                {failure}
              </Text>
            ) : null}
            <DialogFooter>
              <Button variant="quiet" size="lg" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="lg" disabled={saving} onClick={onApprove}>
                Add
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
