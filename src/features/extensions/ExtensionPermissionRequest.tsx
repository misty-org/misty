import { permissionLabel } from "./permissions";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
      if (allowed && extension) {
        await extensionsNative.approve(
          extension.guid,
          request.permissions ?? [],
          request.hosts ?? [],
          false,
        );
        await updateInstallation(extension.id, {
          permissions: [...new Set([...extension.permissions, ...(request.permissions ?? [])])],
          hosts: [...new Set([...extension.hosts, ...(request.hosts ?? [])])],
        });
      }
      await extensionsNative.respond(request.requestId, allowed && Boolean(extension));
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allow additional access?</DialogTitle>
          <DialogDescription>
            {extension?.name ?? "An extension"} is requesting additional permissions. Approved
            access follows your account.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-inside list-disc break-words text-sm">
          {[...(request?.permissions ?? []), ...(request?.hosts ?? [])].map((permission) => (
            <li key={permission} title={permission}>
              {permissionLabel(permission)}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
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
