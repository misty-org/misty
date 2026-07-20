import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  MessageSquare,
  Sparkles,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { SpaceStudioResource } from "../../../spaces/types";
import { useSpacesStore } from "../../../stores/useSpacesStore";

const validSections = new Set(["general", "chat", "studio", "agents"]);
const emptyResources: SpaceStudioResource[] = [];

export function SpaceSettings({ spaceId, section }: { spaceId: string; section: string }) {
  const navigate = useNavigate();
  const activeSection = validSections.has(section) ? section : "general";
  const {
    space,
    agents,
    workflows,
    error,
    renameSpace,
    loadStudio,
    leaveSpace,
    deleteSpace,
    clearError,
  } = useSpacesStore(
    useShallow((state) => ({
      space: state.spaces.find((item) => item.id === spaceId),
      agents: state.agentsBySpace[spaceId] ?? emptyResources,
      workflows: state.workflowsBySpace[spaceId] ?? emptyResources,
      error: state.error,
      renameSpace: state.renameSpace,
      loadStudio: state.loadStudio,
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
  const canViewStudio = space?.permissions?.["studio.view"] !== false;

  useEffect(() => {
    setName(space?.name ?? "");
  }, [space?.name]);
  useEffect(() => {
    if (spaceId && canViewStudio)
      void Promise.all([loadStudio(spaceId, "agents"), loadStudio(spaceId, "workflows")]);
  }, [canViewStudio, loadStudio, spaceId]);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!space || !isOwner || !nextName || nextName === space.name || saving) return;
    clearError();
    setSaving(true);
    try {
      await renameSpace(spaceId, nextName);
    } finally {
      setSaving(false);
    }
  };
  const submitLeave = async () => {
    if (!space || isOwner || dangerBusy) return;
    setDangerBusy(true);
    clearError();
    try {
      await leaveSpace(spaceId);
      navigate("/spaces/personal", { replace: true });
    } catch {
      /* The shared store error remains visible in the dialog. */
    } finally {
      setDangerBusy(false);
    }
  };
  const submitDelete = async () => {
    if (!space || !isOwner || space.is_personal || deleteConfirmation !== space.name || dangerBusy)
      return;
    setDangerBusy(true);
    clearError();
    try {
      await deleteSpace(spaceId, deleteConfirmation);
      navigate("/spaces/personal", { replace: true });
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

  return (
    <div className="h-full overflow-auto bg-background px-6 py-7 sm:px-8 sm:py-9">
      <div className="mx-auto w-full max-w-3xl">
        <h2 className="sr-only">{sectionTitle(activeSection)}</h2>

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
                <Badge variant="outline">
                  {space.is_personal ? "Personal" : space.is_shared ? "Shared" : "Private"}
                </Badge>
              </CardHeader>
              <CardContent>
                <form className="flex max-w-lg gap-2" onSubmit={(event) => void saveName(event)}>
                  <Input
                    aria-label="Space name"
                    maxLength={80}
                    disabled={!isOwner || saving}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  {isOwner ? (
                    <Button
                      className="shrink-0"
                      type="submit"
                      disabled={saving || !name.trim() || name.trim() === space.name}
                    >
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  ) : null}
                </form>
                {!isOwner ? (
                  <p className="mb-0 mt-3 text-xs text-muted-foreground">
                    Only the Space owner can change its name.
                  </p>
                ) : null}
                {error && !leaveOpen && !deleteOpen ? (
                  <Button
                    className="mt-4 h-auto w-full justify-start whitespace-normal rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/15 hover:text-destructive"
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
                {space.is_personal ? (
                  <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                    Your default personal Space cannot be left or deleted.
                  </p>
                ) : isOwner ? (
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
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-sm font-medium">Leave this Space</p>
                      <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
                        You will immediately lose access to chat, tasks, Agents, and protected
                        Library items.
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
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {activeSection === "chat" ? (
          <SettingsCard icon={<MessageSquare className="size-5" />} title="Space chat">
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Fact
                label="People"
                value={`${space.member_count} member${space.member_count === 1 ? "" : "s"}`}
              />
              <Fact
                label="Available Agents"
                value={String(agents.filter((agent) => agent.enabled).length)}
              />
            </div>
            <ActionLink to={`/spaces/${encodeURIComponent(spaceId)}/chat`} label="Open Chat" />
          </SettingsCard>
        ) : null}
        {activeSection === "studio" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <ManagementCard
              icon={<Bot className="size-5" />}
              title="Agents"
              count={agents.length}
              to={`/spaces/${encodeURIComponent(spaceId)}/agents/studio/agents`}
            />
            <ManagementCard
              icon={<Workflow className="size-5" />}
              title="Workflows"
              count={workflows.length}
              to={`/spaces/${encodeURIComponent(spaceId)}/agents/studio/workflows`}
            />
          </div>
        ) : null}
        {activeSection === "agents" ? (
          <SettingsCard icon={<Sparkles className="size-5" />} title="Agents">
            <div className="mt-5 grid gap-1.5">
              {agents.slice(0, 6).map((agent) => (
                <div
                  className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/40 px-3"
                  key={agent.id}
                >
                  <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Bot className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{agent.name}</span>
                  <Badge variant={agent.enabled ? "secondary" : "outline"}>
                    {agent.enabled ? <Check className="mr-1 size-3" /> : null}
                    {agent.enabled ? "Available" : "Off"}
                  </Badge>
                </div>
              ))}
              {agents.length === 0 ? (
                <div className="rounded-lg bg-muted/30 px-4 py-7 text-center">
                  <Users className="mx-auto size-5 text-muted-foreground" />
                  <p className="mb-0 mt-2 text-xs text-muted-foreground">
                    No Agents have been added yet.
                  </p>
                </div>
              ) : null}
            </div>
            <ActionLink
              to={`/spaces/${encodeURIComponent(spaceId)}/agents/studio/agents`}
              label={agents.length === 0 ? "Add an Agent" : "Manage Agents"}
            />
          </SettingsCard>
        ) : null}
      </div>

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
    </div>
  );
}

function SettingsCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted/60 text-muted-foreground">
            {icon}
          </span>
          <CardTitle>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
function ManagementCard({
  icon,
  title,
  count,
  to,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  to: string;
}) {
  return (
    <Link className="group block no-underline" to={to}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-center gap-3 p-5">
          <span className="grid size-9 place-items-center rounded-md bg-muted/60 text-muted-foreground">
            {icon}
          </span>
          <CardTitle>{title}</CardTitle>
          <Badge className="ml-auto" variant="outline">
            {count}
          </Badge>
        </CardContent>
      </Card>
    </Link>
  );
}
function ActionLink({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild className="mt-5" variant="outline">
      <Link to={to}>
        {label}
        <ArrowRight className="size-3.5" />
      </Link>
    </Button>
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
function sectionTitle(section: string) {
  return section === "chat"
    ? "Chat settings"
    : section === "studio"
      ? "Studio settings"
      : section === "agents"
        ? "Agent settings"
        : "Space settings";
}
