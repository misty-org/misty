import { useEffect, useState, type FormEvent } from "react";
import { Cable, Settings2, Trash2, UsersRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui";
import { Input } from "@/ui";
import { Separator } from "@/ui";
import {
  DiscordConnectionPanel,
  GoogleCalendarConnectionPanel,
  NotionConnectionPanel,
} from "@/features/spaces/connections";
import { WorkspaceOverlay } from "@/layouts/DesktopLayout/WorkspaceOverlay";
import {
  DesktopSettingsFrame,
  type DesktopSettingsNavEntry,
} from "@/pages/Settings/DesktopSettingsUI";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpaceMembers } from "./SpaceMembers";
import { canManageSpaceLifecycle, isMistySpace } from "../mistySpace";

type SpaceSettingsSection = "general" | "members" | "connections";

const settingsItems: readonly DesktopSettingsNavEntry<SpaceSettingsSection>[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "members", label: "Members", icon: UsersRound },
  { id: "connections", label: "Connections", icon: Cable },
];

const sectionDescriptions: Record<SpaceSettingsSection, string> = {
  general: "Name, access, ownership, and Space lifecycle.",
  members: "Manage member access, invitations, and permissions.",
  connections: "Services connected to this Space.",
};

export function SpaceSettings({ spaceId, section }: { spaceId: string; section: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = isSpaceSettingsSection(section) ? section : "general";
  const { space, error, renameSpace, leaveSpace, deleteSpace, clearError } = useSpacesStore(
    useShallow((state) => ({
      space: state.spaces.find((item) => item.id === spaceId),
      error: state.error,
      renameSpace: state.renameSpace,
      leaveSpace: state.leaveSpace,
      deleteSpace: state.deleteSpace,
      clearError: state.clearError,
    })),
  );
  const [name, setName] = useState(space?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [dangerBusy, setDangerBusy] = useState(false);
  const isOwner = space?.role === "owner";
  const canRename = isOwner && canManageSpaceLifecycle(space, "rename");
  const canLeave = !isOwner && canManageSpaceLifecycle(space, "leave");
  const canDelete = isOwner && canManageSpaceLifecycle(space, "delete");
  const encodedSpaceId = encodeURIComponent(spaceId);
  const locationState = location.state as { spaceSettingsReturnTo?: string } | null;
  const fallbackReturnPath = `/spaces/${encodedSpaceId}/chat`;
  const closeSettings = () => {
    const destination = locationState?.spaceSettingsReturnTo;
    navigate(
      destination?.startsWith(`/spaces/${encodedSpaceId}/`) && !destination.includes("/settings/")
        ? destination
        : fallbackReturnPath,
      { replace: true },
    );
  };
  const dismissSettings = () => {
    if (leaveOpen || deleteOpen || dangerBusy) return;
    closeSettings();
  };

  useEffect(() => {
    setName(space?.name ?? "");
  }, [space?.name]);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!space || !canRename || !nextName || nextName === space.name || saving) return;
    clearError();
    setSaving(true);
    try {
      await renameSpace(spaceId, nextName);
    } finally {
      setSaving(false);
    }
  };
  const submitLeave = async () => {
    if (!space || !canLeave || dangerBusy) return;
    setDangerBusy(true);
    clearError();
    try {
      await leaveSpace(spaceId);
      navigate("/spaces", { replace: true });
    } catch {
      /* The shared store error remains visible in the dialog. */
    } finally {
      setDangerBusy(false);
    }
  };
  const submitDelete = async () => {
    if (!space || !canDelete || deleteConfirmation !== space.name || dangerBusy) return;
    setDangerBusy(true);
    clearError();
    try {
      await deleteSpace(spaceId, deleteConfirmation);
      navigate("/spaces", { replace: true });
    } catch {
      /* The shared store error remains visible in the dialog. */
    } finally {
      setDangerBusy(false);
    }
  };

  if (!space)
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Loading Space settings…
      </div>
    );

  if (isMistySpace(space)) {
    return (
      <WorkspaceOverlay open style={{}} ariaLabel="Misty Space settings" onClose={dismissSettings}>
        <div className="grid h-full place-items-center px-6 text-center">
          <div className="max-w-md">
            <h1 className="m-0 text-lg font-semibold">Managed by Misty</h1>
            <p className="mb-0 mt-2 text-sm leading-6 text-muted-foreground">
              This guide Space is published for everyone and its membership and settings cannot be
              changed.
            </p>
          </div>
        </div>
      </WorkspaceOverlay>
    );
  }

  return (
    <WorkspaceOverlay
      open
      style={{}}
      ariaLabel={`${space.name} settings`}
      onClose={dismissSettings}
    >
      <>
        <DesktopSettingsFrame
          activeId={activeSection}
          ariaLabel={`${space.name} settings`}
          description={sectionDescriptions[activeSection]}
          items={settingsItems}
          navigationLabel="Space settings sections"
          navigationTitle={space.name}
          onClose={dismissSettings}
          onSelect={(nextSection) =>
            navigate(`/spaces/${encodedSpaceId}/settings/${nextSection}`, {
              replace: true,
              state: location.state,
            })
          }
          presentation="overlay"
          title={settingsItems.find((item) => item.id === activeSection)?.label ?? "General"}
        >
          {activeSection === "general" ? (
            <div className="grid gap-5">
              <Card aria-labelledby="space-name-heading">
                <CardHeader className="flex flex-row items-start justify-between gap-5">
                  <div>
                    <CardTitle id="space-name-heading">Space details</CardTitle>
                    <p className="mb-0 mt-1 text-xs text-muted-foreground">
                      The name and access model shown across Misty.
                    </p>
                  </div>
                  <Badge variant="outline">{space.is_shared ? "Shared" : "Private"}</Badge>
                </CardHeader>
                <CardContent>
                  <form className="flex max-w-lg gap-2" onSubmit={(event) => void saveName(event)}>
                    <Input
                      aria-label="Space name"
                      maxLength={80}
                      disabled={!canRename || saving}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    {canRename ? (
                      <Button
                        className="shrink-0"
                        type="submit"
                        disabled={saving || !name.trim() || name.trim() === space.name}
                      >
                        {saving ? "Saving…" : "Save"}
                      </Button>
                    ) : null}
                  </form>
                  {!canRename ? (
                    <p className="mb-0 mt-3 text-xs text-muted-foreground">
                      Only the Space owner can change its name.
                    </p>
                  ) : null}
                  {error && !leaveOpen && !deleteOpen ? (
                    <Button
                      className={[
                        "mt-4 h-auto w-full justify-start whitespace-normal rounded-lg border",
                        "border-destructive/25 bg-destructive/10 px-3 py-2 text-left text-xs",
                        "text-destructive hover:bg-destructive/15 hover:text-destructive",
                      ].join(" ")}
                      variant="ghost"
                      type="button"
                      onClick={clearError}
                    >
                      {error}
                    </Button>
                  ) : null}
                  <Separator className="my-5" />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Fact label="Members" value={String(space.member_count)} />
                    <Fact label="Your role" value={isOwner ? "Owner" : "Member"} />
                    <Fact label="Access" value={space.is_shared ? "Shared" : "Private"} />
                  </div>
                </CardContent>
              </Card>

              <Card className="ring-destructive/20" aria-labelledby="space-danger-heading">
                <CardHeader>
                  <CardTitle className="text-destructive" id="space-danger-heading">
                    Danger zone
                  </CardTitle>
                  <p className="mb-0 mt-1 text-xs text-muted-foreground">
                    Actions here can remove access or permanently delete this Space.
                  </p>
                </CardHeader>
                <CardContent>
                  {canDelete ? (
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-medium">Delete this Space</p>
                        <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
                          Member access is removed immediately. Permanent deletion follows recovery
                          and storage safety checks.
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        type="button"
                        onClick={() => {
                          clearError();
                          setDeleteConfirmation("");
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="size-4" />
                        Delete Space
                      </Button>
                    </div>
                  ) : canLeave ? (
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-medium">Leave this Space</p>
                        <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
                          You will immediately lose access to chat, Planner, and protected Library
                          items.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                          clearError();
                          setLeaveOpen(true);
                        }}
                      >
                        Leave Space
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {activeSection === "members" ? <SpaceMembers embedded spaceId={spaceId} /> : null}

          {activeSection === "connections" ? (
            <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <GoogleCalendarConnectionPanel spaceId={spaceId} canManage={isOwner} />
              <NotionConnectionPanel spaceId={spaceId} canManage={isOwner} />
              <DiscordConnectionPanel spaceId={spaceId} canManage={isOwner} />
            </div>
          ) : null}
        </DesktopSettingsFrame>

        <AlertDialog
          open={leaveOpen}
          onOpenChange={(open) => !open && !dangerBusy && setLeaveOpen(false)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave {space.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                You will immediately lose access. Another member must invite you to regain it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? <DangerError message={error} /> : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={dangerBusy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={dangerBusy}
                onClick={(event) => {
                  event.preventDefault();
                  void submitLeave();
                }}
              >
                {dangerBusy ? "Leaving…" : "Leave Space"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (!open && !dangerBusy) {
              setDeleteOpen(false);
              setDeleteConfirmation("");
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-destructive">Delete {space.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes member access immediately and schedules permanent deletion. Type the
                Space name exactly to continue.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="grid gap-2 text-xs font-medium text-muted-foreground">
              Space name
              <Input
                autoFocus
                autoComplete="off"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            {error ? <DangerError message={error} /> : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={dangerBusy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={dangerBusy || deleteConfirmation !== space.name}
                onClick={(event) => {
                  event.preventDefault();
                  void submitDelete();
                }}
              >
                {dangerBusy ? "Deleting…" : "Delete Space"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    </WorkspaceOverlay>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/45 px-3 py-2.5">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <span className="mt-0.5 block truncate text-xs font-medium capitalize">{value}</span>
    </div>
  );
}
function DangerError({ message }: { message: string }) {
  return (
    <p
      className="m-0 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      role="alert"
    >
      {message}
    </p>
  );
}

function isSpaceSettingsSection(value: string): value is SpaceSettingsSection {
  return settingsItems.some((item) => item.id === value);
}
