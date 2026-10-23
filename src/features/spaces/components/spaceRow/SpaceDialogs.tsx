import { useEffect, useState, type FormEvent } from "react";
import type { Space } from "@/api/spaces/dto/entities";
import { Button, cn, Input, PopoverContent } from "@/shared/ui";
import { SpaceColorPanel } from "./SpaceColorPanel";
import { SpaceMembers } from "../../members";
import { LeaveDeleteSpaceDialogs } from "../LeaveDeleteSpaceDialogs";
import { SpaceSiteLinks } from "../SpaceSiteLinks";
import { useSpaceLifecycleActions } from "../useSpaceLifecycleActions";
import { useSpacesStore } from "../../store/useSpacesStore";

/** The small windows the Space menu and People open, in place of a settings page. */
export type SpaceDialog =
  "rename" | "color" | "sites" | "members" | "invite" | "leave" | "delete" | null;

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
  const wide = open === "sites" || open === "members" || open === "invite";
  return (
    <>
      {isSpacePanel(open) && (
        <PopoverContent
          align="start"
          sideOffset={8}
          aria-label={panelLabel(open, space.name)}
          className={cn(
            "max-h-[80vh] max-w-[calc(100vw-24px)] overflow-y-auto p-4",
            wide ? "w-[40rem]" : "w-72",
          )}
          // The menu hands focus back as it closes; only a press outside leaves the panel.
          onFocusOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={onClose}
        >
          {open === "rename" && <RenameSpace space={space} onDone={onClose} />}
          {open === "color" && <SpaceColorPanel />}
          {open === "sites" && <SpaceSiteLinks spaceId={space.id} />}
          {(open === "members" || open === "invite") && (
            <SpaceMembers embedded spaceId={space.id} invite={open === "invite"} />
          )}
        </PopoverContent>
      )}
      <LeaveDeleteSpaceDialogs spaceName={space.name} controller={controller} />
    </>
  );
}

/** The dialogs that open as a panel beside the Space row; leave and delete stay confirmations. */
export const isSpacePanel = (dialog: SpaceDialog) =>
  dialog !== null && dialog !== "leave" && dialog !== "delete";

function panelLabel(dialog: SpaceDialog, name: string) {
  if (dialog === "rename") return `Rename ${name}`;
  if (dialog === "color") return "Space color";
  if (dialog === "sites") return `Sites that open in ${name}`;
  return `People in ${name}`;
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
      <p className="m-0 text-sm font-medium text-cream">Rename {space.name}</p>
      <p className="mb-0 mt-1 text-xs text-cream-muted">Everyone in the Space sees the new name.</p>
      <Input
        autoFocus
        aria-label="Space name"
        maxLength={80}
        className="mt-3"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {failed && (
        <p role="alert" className="mb-0 mt-3 text-sm text-cream">
          The name wasn't saved. Try again.
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !name.trim()}>
          Rename
        </Button>
      </div>
    </form>
  );
}
