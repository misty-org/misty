import { useEffect, useState, type FormEvent } from "react";
import type { Space } from "@/api/spaces/dto/entities";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { SpaceMembers } from "../../members";
import { SpaceSettingsApps } from "../SpaceSettingsApps";
import { SpaceSettingsDangerDialogs } from "../SpaceSettingsDangerDialogs";
import { SpaceSiteLinks } from "../SpaceSiteLinks";
import { useSpaceSettingsController } from "../useSpaceSettingsController";
import { useSpacesStore } from "../../store/useSpacesStore";

/** The small windows the Space menu and People open, in place of a settings page. */
export type SpaceDialog =
  "rename" | "apps" | "sites" | "members" | "invite" | "leave" | "delete" | null;

export function SpaceDialogs({
  space,
  open,
  onClose,
}: {
  space: Space;
  open: SpaceDialog;
  onClose: () => void;
}) {
  const controller = useSpaceSettingsController(space.id);
  const { setLeaveOpen, setDeleteOpen, setDeleteConfirmation, clearError } = controller;
  // Leave and delete use the confirmations the settings page had.
  useEffect(() => {
    if (open !== "leave" && open !== "delete") return;
    clearError();
    if (open === "leave") setLeaveOpen(true);
    else {
      setDeleteConfirmation("");
      setDeleteOpen(true);
    }
    onClose();
  }, [open, clearError, setLeaveOpen, setDeleteOpen, setDeleteConfirmation, onClose]);
  const dismiss = (next: boolean) => {
    if (!next) onClose();
  };
  return (
    <>
      <Dialog open={open === "rename"} onOpenChange={dismiss}>
        <DialogContent className="max-w-sm">
          <RenameSpace space={space} onDone={onClose} />
        </DialogContent>
      </Dialog>
      <Dialog open={open === "apps"} onOpenChange={dismiss}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Apps {space.name} uses</DialogTitle>
          </DialogHeader>
          <SpaceSettingsApps spaceId={space.id} spaceName={space.name} />
        </DialogContent>
      </Dialog>
      <Dialog open={open === "sites"} onOpenChange={dismiss}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Sites that open in {space.name}</DialogTitle>
          </DialogHeader>
          <SpaceSiteLinks spaceId={space.id} />
        </DialogContent>
      </Dialog>
      <Dialog open={open === "members" || open === "invite"} onOpenChange={dismiss}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>People in {space.name}</DialogTitle>
          </DialogHeader>
          <SpaceMembers embedded spaceId={space.id} invite={open === "invite"} />
        </DialogContent>
      </Dialog>
      <SpaceSettingsDangerDialogs spaceName={space.name} controller={controller} />
    </>
  );
}

function RenameSpace({ space, onDone }: { space: Space; onDone: () => void }) {
  const renameSpace = useSpacesStore((state) => state.renameSpace);
  const [name, setName] = useState(space.name);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === space.name) return onDone();
    setSaving(true);
    setFailed(false);
    try {
      await renameSpace(space.id, next);
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <DialogHeader>
        <DialogTitle>Rename {space.name}</DialogTitle>
        <DialogDescription>Everyone in the Space sees the new name.</DialogDescription>
      </DialogHeader>
      <Input
        autoFocus
        aria-label="Space name"
        maxLength={80}
        className="mt-5"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {failed && (
        <p role="alert" className="mb-0 mt-3 text-sm text-cream">
          The name wasn't saved. Try again.
        </p>
      )}
      <DialogFooter className="mt-5">
        <Button variant="outline" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !name.trim()}>
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}
