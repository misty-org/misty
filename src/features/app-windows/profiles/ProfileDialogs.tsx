import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useShortcutHandler } from "@/features/shortcuts";
import { setBrowserWebviewsSuspended } from "../page-runtime/browserOverlayRuntime";
import { createProfile, deleteProfile, firstProfileId, renameProfile } from "./profileWindow";
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
  Dialog,
  DialogContent,
  DialogTitle,
  ErrorNotification,
  Input,
} from "@/shared/ui";
import { ProfileColorPanel } from "./ProfileColorPanel";
import { useDialogProfile, useProfileDialogs } from "./profileDialogStore";
import { ProfileSiteLinks } from "./ProfileSiteLinks";

const failureText = (error: unknown, fallback: string) =>
  typeof error === "string" ? error : error instanceof Error ? error.message : fallback;

/** Naming a new profile, or renaming one. */
function ProfileNameForm({ rename, onDone }: { rename: boolean; onDone: () => void }) {
  const profile = useDialogProfile();
  const [name, setName] = useState(rename ? profile.name : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next) return;
    setSaving(true);
    setError("");
    try {
      if (rename) await renameProfile(profile.id, next);
      else await createProfile(next);
      onDone();
    } catch (cause) {
      setError(failureText(cause, "That didn't save. Try again."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      <DialogTitle className="text-lg">{rename ? "Rename profile" : "Add a profile"}</DialogTitle>
      <Input
        autoFocus
        aria-label="Profile name"
        maxLength={60}
        placeholder="Work"
        disabled={saving}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <ErrorNotification message={error} onDismiss={() => setError("")} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !name.trim()}>
          {rename ? "Rename" : "Add profile"}
        </Button>
      </div>
    </form>
  );
}

function DeleteProfileDialog({ onDone }: { onDone: () => void }) {
  const profile = useDialogProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      // Its windows close, and this one too if it's this window's profile.
      await deleteProfile(profile.id);
      onDone();
    } catch (cause) {
      setError(failureText(cause, "The profile couldn't be deleted. Try again."));
      setBusy(false);
    }
  };
  return (
    <AlertDialogContent className="max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {profile.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes it from every computer: its tabs, bookmarks, history, passwords, extensions
          and website sign-ins. Its windows close.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Keep profile</AlertDialogCancel>
        <AlertDialogAction
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          Delete profile
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

/** Every profile dialog, opened from the account menu, the sidebar or `workspace.new_profile`. */
export function ProfileDialogs() {
  const open = useProfileDialogs((state) => state.open);
  const show = useProfileDialogs((state) => state.show);
  const close = useProfileDialogs((state) => state.close);
  const profileId = useDialogProfile().id;
  useShortcutHandler(
    "workspace.new_profile",
    useCallback(() => show("create"), [show]),
  );
  // Native page views draw above the app, so hide them while a dialog is up.
  useEffect(() => {
    setBrowserWebviewsSuspended(Boolean(open), "profile-dialog");
    return () => setBrowserWebviewsSuspended(false, "profile-dialog");
  }, [open]);
  const dismiss = (next: boolean) => {
    if (!next) close();
  };
  const formOpen = open === "create" || open === "rename";
  return (
    <>
      <Dialog open={formOpen} onOpenChange={dismiss}>
        <DialogContent aria-describedby={undefined} className="max-w-[400px]">
          {formOpen ? (
            <ProfileNameForm key={open} rename={open === "rename"} onDone={close} />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={open === "color"} onOpenChange={dismiss}>
        <DialogContent aria-describedby={undefined} className="max-w-[360px]">
          <DialogTitle className="text-lg">Profile color</DialogTitle>
          <ProfileColorPanel />
        </DialogContent>
      </Dialog>
      <Dialog open={open === "sites"} onOpenChange={dismiss}>
        <DialogContent aria-describedby={undefined} className="max-w-[480px]">
          <DialogTitle className="text-lg">Sites that open here</DialogTitle>
          <ProfileSiteLinks />
        </DialogContent>
      </Dialog>
      <AlertDialog open={open === "delete" && profileId !== firstProfileId} onOpenChange={dismiss}>
        {open === "delete" ? <DeleteProfileDialog onDone={close} /> : null}
      </AlertDialog>
    </>
  );
}
