import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import {
  AppLogoImage,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  PropertyList,
  Text,
} from "@misty/ui";
import { permissionLines } from "./appPermissions";
import { appHosts, type AppSource, type ResolvedLink } from "./thirdPartyApps";

const messageOf = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : typeof reason === "string" && reason ? reason : fallback;

/**
 * Adds an app to a Space by its GitHub link, for a mod. Misty resolves the link (`space_app_resolve`): its reviewed
 * catalog, else the maker's own `misty-app.json`, else the basic check. What the app may do and reach shows before
 * it is added; an app Misty hasn't reviewed says so.
 */
export function AddFromGitHubDialog({
  onAdd,
  onClose,
}: {
  /** Adds the resolved app to the Space. If it throws, its message shows and the dialog stays. */
  onAdd(source: AppSource): Promise<unknown>;
  onClose(): void;
}) {
  const [link, setLink] = useState("");
  const [found, setFound] = useState<AppSource | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    setError("");
    setFound(null);
    try {
      const resolved = await invoke<ResolvedLink>("space_app_resolve", { link: link.trim() });
      if (resolved.result === "incompatible") setError(resolved.reason);
      else setFound(resolved);
    } catch (reason) {
      setError(messageOf(reason, "Misty couldn't check that link. Try again."));
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!found) return;
    setBusy(true);
    setError("");
    try {
      await onAdd(found);
      onClose();
    } catch (reason) {
      setError(messageOf(reason, `${found.entry.name} couldn't be added.`));
      setBusy(false);
    }
  };
  const hosts = found ? appHosts(found.entry) : [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent size="sm" aria-describedby={undefined}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !link.trim()) return;
            void (found ? add() : check());
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Add from GitHub</DialogTitle>
          </DialogHeader>
          <Field label="Repository link" error={error}>
            <Input
              autoFocus
              value={link}
              disabled={busy}
              placeholder="github.com/owner/app"
              onChange={(event) => {
                setLink(event.target.value);
                setFound(null);
                setError("");
              }}
            />
          </Field>
          {found ? (
            <div className="flex flex-col gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <AppLogoImage src={found.entry.logo} name={found.entry.name} size="card" />
                <div className="flex min-w-0 flex-col">
                  <Text weight="medium">{found.entry.name}</Text>
                  <Text size="meta" tone="muted">
                    {`by ${found.entry.maker}`}
                  </Text>
                </div>
              </div>
              {found.listed ? null : (
                <Text as="p" size="meta" tone="muted" wrap className="m-0">
                  Misty hasn't reviewed this app. It runs sandboxed on its own, but check that you trust its
                  maker before adding it.
                </Text>
              )}
              <PropertyList
                label="About the app"
                items={[
                  { label: "Version", value: found.entry.version },
                  { label: "License", value: found.entry.license },
                  {
                    label: "Can",
                    value: found.entry.permissions.length
                      ? found.entry.permissions.map((name) => permissionLines[name] ?? name).join(". ")
                      : "Run on its own",
                  },
                  {
                    label: "Reaches",
                    value: hosts.length
                      ? hosts.map((entry) => (entry.paid ? `${entry.host} (paid)` : entry.host)).join(", ")
                      : "Nothing on the internet",
                  },
                ]}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="quiet" size="lg" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={busy || !link.trim()}>
              {found ? "Add" : "Check"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
