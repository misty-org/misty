import { useEffect } from "react";
import type { Space } from "../../api/dto/entities";
import { spaceCan } from "../../roles/use_space_roles";
import { InviteDialog } from "../../settings/InviteDialog";
import { SpaceSettings } from "../../settings/SpaceSettings";
import type { SpaceSettingsPage } from "../../settings/space_settings_pages";
import { LeaveSpaceDialog } from "../SpaceLifecycleDialogs";
import { useSpaceLifecycleActions } from "../use_space_lifecycle_actions";

export type SpaceDialog = SpaceSettingsPage | "invite" | "leave" | null;

function settingsPage(dialog: SpaceDialog): SpaceSettingsPage | null {
  return dialog === "invite" || dialog === "leave" ? null : dialog;
}

export function SpaceDialogs({
  space,
  open,
  onOpen,
  onClose,
}: {
  space: Space;
  open: SpaceDialog;
  onOpen: (dialog: SpaceDialog) => void;
  onClose: () => void;
}) {
  const controller = useSpaceLifecycleActions(space.id);
  const { setLeaveOpen, clearError } = controller;
  useEffect(() => {
    if (open !== "leave") return;
    clearError();
    setLeaveOpen(true);
    onClose();
  }, [open, clearError, setLeaveOpen, onClose]);
  return (
    <>
      <SpaceSettings space={space} page={settingsPage(open)} onPage={onOpen} onClose={onClose} />
      {!space.is_default && spaceCan(space, "space.invite") ? (
        <InviteDialog
          space={space}
          open={open === "invite"}
          onOpenChange={(next) => !next && onClose()}
        />
      ) : null}
      <LeaveSpaceDialog spaceName={space.name} controller={controller} />
    </>
  );
}
