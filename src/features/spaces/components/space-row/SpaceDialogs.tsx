import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_PICTURE_BYTES, toSquarePng, PICTURE_TYPES } from "@/shared/lib/square_png";
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
} from "@misty/ui";
import { SpaceMembers } from "../../members";
import { SpaceFoldersSection } from "../../folders/SpaceFoldersSection";
import { LeaveDeleteSpaceDialogs } from "../LeaveDeleteSpaceDialogs";
import { useSpaceLifecycleActions } from "../use_space_lifecycle_actions";
import { useSpacesStore } from "../../list/use_spaces_store";

export type SpaceDialog = "rename" | "members" | "invite" | "folders" | "leave" | "delete" | null;

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
  const { picker, picture } = useSpacePicture(space.id);
  const { setLeaveOpen, setDeleteOpen, setDeleteConfirmation, clearError } = controller;
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
      {picker}
      {isSpacePanel(open) && (
        <PopoverContent
          align="start"
          sideOffset={8}
          aria-label={`Rename ${space.name}`}
          onFocusOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={onClose}
        >
          <RenameSpace space={space} picture={picture} onDone={onClose} />
        </PopoverContent>
      )}
      <Dialog open={people} onOpenChange={(next) => !next && onClose()}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{`People in ${space.name}`}</DialogTitle>
          </DialogHeader>
          {people ? <SpaceMembers embedded spaceId={space.id} invite={open === "invite"} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={open === "folders"} onOpenChange={(next) => !next && onClose()}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Shared folders</DialogTitle>
          </DialogHeader>
          {open === "folders" ? <SpaceFoldersSection spaceId={space.id} /> : null}
        </DialogContent>
      </Dialog>
      <LeaveDeleteSpaceDialogs spaceName={space.name} controller={controller} />
    </>
  );
}

export const isSpacePanel = (dialog: SpaceDialog) => dialog === "rename";

interface SpacePicture {
  working: boolean;
  error: string;
  pick(): void;
  remove(): void;
}

function useSpacePicture(spaceId: string) {
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
    }
  };
  const upload = (file: File | undefined) =>
    file &&
    void change(async () => {
      const png = await toSquarePng(file);
      if (png.size > MAX_PICTURE_BYTES) throw new Error("That image is too large.");
      await spacesApi.setSpacePicture(spaceId, png);
    });
  const picker = (
    <FileInput
      ref={input}
      accept={PICTURE_TYPES}
      aria-label="Space picture"
      onChange={(event) => {
        upload(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );
  const picture: SpacePicture = {
    working,
    error,
    pick: () => input.current?.click(),
    remove: () => void change(() => spacesApi.removeSpacePicture(spaceId)),
  };
  return { picker, picture };
}

function SpacePictureField({ space, picture }: { space: Space; picture: SpacePicture }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-3">
        <SpaceAvatar space={space} className="size-10" />
        <Button variant="secondary" type="button" disabled={picture.working} onClick={picture.pick}>
          Change picture
        </Button>
        {space.avatar_version ? (
          <Button variant="quiet" type="button" disabled={picture.working} onClick={picture.remove}>
            Remove
          </Button>
        ) : null}
      </div>
      <FieldError id="space-picture-error" message={picture.error} />
    </div>
  );
}

function RenameSpace({
  space,
  picture,
  onDone,
}: {
  space: Space;
  picture: SpacePicture;
  onDone: () => void;
}) {
  const renameSpace = useSpacesStore((state) => state.renameSpace);
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
    <form className="contents" onSubmit={(event) => void submit(event)}>
      <PopoverHeader title={`Edit ${space.name}`} />
      <PopoverText>Everyone in the Space sees its name and picture.</PopoverText>
      <PopoverBody>
        <SpacePictureField space={current ?? space} picture={picture} />
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
