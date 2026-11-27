import { lazy, Suspense, useEffect, useState } from "react";
import type { Space } from "../../api/dto/entities";
import { spaceCan } from "../../roles/use_space_roles";
import type { SpaceSettingsPage } from "../../settings/space_settings_pages";
import { LeaveSpaceDialog } from "../SpaceLifecycleDialogs";
import { useSpaceLifecycleActions } from "../use_space_lifecycle_actions";

const SpaceSettings = lazy(() =>
  import("../../settings/SpaceSettings").then((module) => ({ default: module.SpaceSettings })),
);
const InviteDialog = lazy(() =>
  import("../../settings/InviteDialog").then((module) => ({ default: module.InviteDialog })),
);

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
  const page = settingsPage(open);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [inviteMounted, setInviteMounted] = useState(false);
  if (page && !settingsMounted) setSettingsMounted(true);
  if (open === "invite" && !inviteMounted) setInviteMounted(true);
  const { setLeaveOpen, clearError } = controller;
  useEffect(() => {
    if (open !== "leave") return;
    clearError();
    setLeaveOpen(true);
    onClose();
  }, [open, clearError, setLeaveOpen, onClose]);
  return (
    <>
      <Suspense fallback={null}>
        {settingsMounted ? (
          <SpaceSettings space={space} page={page} onPage={onOpen} onClose={onClose} />
        ) : null}
        {inviteMounted && !space.is_default && spaceCan(space, "space.invite") ? (
          <InviteDialog
            space={space}
            open={open === "invite"}
            onOpenChange={(next) => !next && onClose()}
          />
        ) : null}
      </Suspense>
      <LeaveSpaceDialog spaceName={space.name} controller={controller} />
    </>
  );
}
