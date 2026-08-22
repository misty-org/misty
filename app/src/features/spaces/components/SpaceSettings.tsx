import { DesktopSettingsFrame, type DesktopSettingsNavEntry } from "@/features/settings";
import { SpaceMembers } from "@/features/spaces/members";
import { NotionConnectionPanel } from "@/features/spaces/integrations";
import { spacesApi } from "@/api/spaces/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Separator,
  Switch,
} from "@/shared/ui";
import { WorkspaceOverlay } from "@/shared/ui/workspace-overlay";
import { Lightbulb, Plug, Settings2, Trash2, UsersRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { canManageSpaceLifecycle } from "../mistySpace";
import { useSpacesStore } from "../store/useSpacesStore";

type SpaceSettingsSection = "general" | "members" | "connections" | "suggestions";

const settingsItems: readonly DesktopSettingsNavEntry<SpaceSettingsSection>[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "members", label: "Members", icon: UsersRound },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "suggestions", label: "Suggestions", icon: Lightbulb },
];

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
      <div className="grid h-full place-items-center text-sm text-cream-muted">
        Loading Space settings…
      </div>
    );

  return (
    <WorkspaceOverlay open ariaLabel={`${space.name} settings`} onClose={dismissSettings}>
      <>
        <DesktopSettingsFrame
          activeId={activeSection}
          ariaLabel={`${space.name} settings`}
          items={settingsItems}
          navigationLabel="Space settings sections"
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
          {activeSection === "connections" ? (
            <div className="grid gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>Journal connections</CardTitle>
                  <p className="mb-0 mt-1 text-xs text-cream-muted">
                    Bring selected Notion pages into Journal. Connector sync runs automatically.
                  </p>
                </CardHeader>
                <CardContent>
                  <NotionConnectionPanel spaceId={spaceId} canManage={isOwner} expandedByDefault />
                </CardContent>
              </Card>
            </div>
          ) : activeSection === "general" ? (
            <div className="grid gap-5">
              <Card aria-labelledby="space-name-heading">
                <CardHeader className="flex flex-row items-start justify-between gap-5">
                  <div>
                    <CardTitle id="space-name-heading">Space details</CardTitle>
                    <p className="mb-0 mt-1 text-xs text-cream-muted">
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
                    <p className="mb-0 mt-3 text-xs text-cream-muted">
                      Only the Space owner can change its name.
                    </p>
                  ) : null}
                  {error && !leaveOpen && !deleteOpen ? (
                    <Button
                      className={[
                        "mt-4 h-auto w-full justify-start whitespace-normal rounded-lg border",
                        "border-charcoal-active/25 bg-charcoal-active px-3 py-2 text-left text-xs",
                        "text-cream-bright hover:bg-charcoal-active hover:text-cream-bright",
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

              <Card className="ring-charcoal-active/20" aria-labelledby="space-danger-heading">
                <CardHeader>
                  <CardTitle className="text-cream-bright" id="space-danger-heading">
                    Danger zone
                  </CardTitle>
                  <p className="mb-0 mt-1 text-xs text-cream-muted">
                    Actions here can remove access or permanently delete this Space.
                  </p>
                </CardHeader>
                <CardContent>
                  {canDelete ? (
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-medium">Delete this Space</p>
                        <p className="mb-0 mt-1 text-xs leading-relaxed text-cream-muted">
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
                        <p className="mb-0 mt-1 text-xs leading-relaxed text-cream-muted">
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

          {activeSection === "suggestions" ? (
            <SuggestionSettingsPanel spaceId={spaceId} isOwner={isOwner} />
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
                className="bg-charcoal-active text-cream-bright hover:bg-charcoal-active"
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
              <AlertDialogTitle className="text-cream-bright">
                Delete {space.name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This removes member access immediately and schedules permanent deletion. Type the
                Space name exactly to continue.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="grid gap-2 text-xs font-medium text-cream-muted">
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
                className="bg-charcoal-active text-cream-bright hover:bg-charcoal-active"
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
    <div className="min-w-0 rounded-lg bg-charcoal-card px-3 py-2.5">
      <span className="block text-[10px] text-cream-muted">{label}</span>
      <span className="mt-0.5 block truncate text-xs font-medium capitalize">{value}</span>
    </div>
  );
}
function DangerError({ message }: { message: string }) {
  return (
    <p
      className="m-0 rounded-lg border border-charcoal-active/25 bg-charcoal-active px-3 py-2 text-xs text-cream-bright"
      role="alert"
    >
      {message}
    </p>
  );
}

function SuggestionSettingsPanel({ spaceId, isOwner }: { spaceId: string; isOwner: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [usage, setUsage] = useState({ used: 0, limit: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void spacesApi
      .actionSuggestionSettings(spaceId)
      .then((settings) => {
        if (!active) return;
        setEnabled(settings.enabled);
        setUsage({ used: settings.weekly_used, limit: settings.weekly_limit });
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error ? reason.message : "Suggestion settings could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [spaceId]);
  const change = async (next: boolean) => {
    if (!isOwner || saving) return;
    setSaving(true);
    setError("");
    try {
      const settings = await spacesApi.updateActionSuggestionSettings(spaceId, next);
      setEnabled(settings.enabled);
      setUsage({ used: settings.weekly_used, limit: settings.weekly_limit });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The setting could not be changed.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action suggestions</CardTitle>
        <p className="mb-0 mt-1 text-xs leading-relaxed text-cream-muted">
          When people explicitly agree on a plan, Misty may offer a private review card with tasks,
          events, notes, roadmap items, or follow-ups. It never runs an action automatically.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="m-0 text-sm font-medium">Suggest actions from agreements</p>
            <p className="mb-0 mt-1 text-xs text-cream-muted">
              Off by default. Any participant can veto analysis in a private conversation.
            </p>
          </div>
          <Switch
            aria-label="Suggest actions from agreements"
            checked={enabled}
            disabled={loading || saving || !isOwner}
            onCheckedChange={(next) => void change(next)}
          />
        </div>
        {enabled ? (
          <p className="mb-0 mt-4 text-xs text-cream-muted">
            This week: {usage.used} of {usage.limit} detector checks used.
          </p>
        ) : null}
        {!isOwner ? (
          <p className="mb-0 mt-4 text-xs text-cream-muted">
            Only the Space owner can change this setting.
          </p>
        ) : null}
        {error ? (
          <p className="mb-0 mt-4 text-xs text-cream-bright" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function isSpaceSettingsSection(value: string): value is SpaceSettingsSection {
  return settingsItems.some((item) => item.id === value);
}
