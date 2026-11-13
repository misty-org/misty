import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_PICTURE_BYTES, toSquarePng, PICTURE_TYPES } from "@/shared/lib/squarePng";
import { spacesApi } from "../../api/api";
import { SpaceAvatar } from "../SpaceAvatar";
import type { Space } from "../../api/dto/entities";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  FieldError,
  FileInput,
  Input,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverText,
} from "@/shared/ui";
import { SpaceMembers } from "../../members";
import { LeaveDeleteSpaceDialogs } from "../LeaveDeleteSpaceDialogs";
import { useSpaceLifecycleActions } from "../useSpaceLifecycleActions";
import { useSpacesStore } from "../../list/useSpacesStore";

/** The small windows the Space menu and People open, in place of a settings page. */
export type SpaceDialog = "rename" | "members" | "invite" | "leave" | "delete" | null;

export function SpaceDialogs({
  space,
  open,
  onClose,
}: {
  space: Space;
  open: SpaceDialog;
  onClose: () => void;
}) {
  const controller = useSpaceLifecycleActions(space.id);
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
  const people = open === "members" || open === "invite";
  return (
    <>
      {isSpacePanel(open) && (
        <PopoverContent
          align="start"
          sideOffset={8}
          aria-label={`Rename ${space.name}`}
          // The menu hands focus back as it closes; only a press outside leaves the panel.
          onFocusOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={onClose}
        >
          <RenameSpace space={space} onDone={onClose} />
        </PopoverContent>
      )}
      {/* People is a list with its own actions, more than a popover holds: a Dialog. */}
      <Dialog open={people} onOpenChange={(next) => !next && onClose()}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{`People in ${space.name}`}</DialogTitle>
          </DialogHeader>
          {people ? <SpaceMembers embedded spaceId={space.id} invite={open === "invite"} /> : null}
        </DialogContent>
      </Dialog>
      <LeaveDeleteSpaceDialogs spaceName={space.name} controller={controller} />
    </>
  );
}

/**
 * The one that opens as a panel beside the Space row: rename. People opens in a Dialog; leave and
 * delete stay confirmations.
 */
export const isSpacePanel = (dialog: SpaceDialog) => dialog === "rename";

/**
 * The Space's picture in the name panel: the picture, then Change, and Remove once it has one.
 * The picture saves the moment it is picked, like a profile picture; everyone in the Space sees it.
 */
function SpacePictureField({ space }: { space: Space }) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const change = async (work: () => Promise<unknown>) => {
    setError("");
    setWorking(true);
    try {
      await work();
      await useSpacesStore.getState().load({ force: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The picture wasn't saved. Try again.");
    } finally {
      setWorking(false);
      // Lets the same file be picked again after a failure.
      if (input.current) input.current.value = "";
    }
  };
  const upload = (file: File | undefined) =>
    file &&
    void change(async () => {
      const png = await toSquarePng(file);
      if (png.size > MAX_PICTURE_BYTES) throw new Error("That image is too large.");
      await spacesApi.setSpacePicture(space.id, png);
    });
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-3">
        <SpaceAvatar space={space} className="size-10" />
        <FileInput
          ref={input}
          accept={PICTURE_TYPES}
          aria-label="Space picture"
          onChange={(event) => upload(event.target.files?.[0])}
        />
        <Button
          variant="secondary"
          type="button"
          loading={working}
          onClick={() => input.current?.click()}
        >
          Change picture
        </Button>
        {space.avatar_version ? (
          <Button
            variant="quiet"
            type="button"
            disabled={working}
            onClick={() => void change(() => spacesApi.removeSpacePicture(space.id))}
          >
            Remove
          </Button>
        ) : null}
      </div>
      <FieldError id="space-picture-error" message={error} />
    </div>
  );
}

function RenameSpace({ space, onDone }: { space: Space; onDone: () => void }) {
  const renameSpace = useSpacesStore((state) => state.renameSpace);
  // The panel shows the Space as the store has it now, so a new picture shows at once.
  const current = useSpacesStore((state) => state.spaces.find((item) => item.id === space.id));
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
    // `contents`: the form's parts take the panel's own rhythm.
    <form className="contents" onSubmit={(event) => void submit(event)}>
      <PopoverHeader title={`Edit ${space.name}`} />
      <PopoverText>Everyone in the Space sees its name and picture.</PopoverText>
      <PopoverBody>
        <SpacePictureField space={current ?? space} />
        <Input
          autoFocus
          aria-label="Space name"
          aria-describedby={failed ? "rename-space-error" : undefined}
          aria-invalid={failed || undefined}
          maxLength={64}
          value={name}
          onChange={(event) => (setName(event.target.value), setFailed(false))}
        />
        <FieldError
          id="rename-space-error"
          message={failed ? "The name wasn't saved. Try again." : ""}
        />
      </PopoverBody>
      <PopoverActions>
        <Button variant="quiet" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="secondary" type="submit" disabled={saving || !name.trim()}>
          Save
        </Button>
      </PopoverActions>
    </form>
  );
}
