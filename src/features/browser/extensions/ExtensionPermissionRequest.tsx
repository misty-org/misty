import { accessLabels } from "./permissions";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorNotification,
} from "@/shared/ui";
import { extensionsNative } from "./native";
import { finishPermission, installations, updateInstallation, useExtensionsStore } from "./store";

export function ExtensionPermissionRequest() {
  const request = useExtensionsStore((s) => s.permissionRequests[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const extension = installations().find((i) => i.guid === request?.guid && i.installed);
  async function respond(allowed: boolean) {
    if (!request?.requestId) return;
    setBusy(true);
    setError("");
    try {
      // The answer first: native records the approval, and the list that follows stays within it.
      await extensionsNative.respond(request.requestId, allowed && Boolean(extension));
      if (allowed && extension) {
        await updateInstallation(extension.id, {
          permissions: [...new Set([...extension.permissions, ...(request.permissions ?? [])])],
          hosts: [...new Set([...extension.hosts, ...(request.hosts ?? [])])],
        });
      }
      finishPermission(request.requestId);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && !busy) void respond(false);
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{extension?.name ?? "An extension"} is asking for more access</DialogTitle>
        </DialogHeader>
        <ul className="list-inside list-disc break-words text-sm">
          {accessLabels([...(request?.permissions ?? []), ...(request?.hosts ?? [])]).map(
            ({ label, source }) => (
              <li key={label} title={source}>
                {label}
              </li>
            ),
          )}
        </ul>
        <ErrorNotification message={error} onDismiss={() => setError("")} />
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => void respond(false)}>
            Deny
          </Button>
          <Button disabled={busy || !extension} onClick={() => void respond(true)}>
            {busy ? "Saving…" : "Allow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
