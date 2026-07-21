import type { MemberAction } from "@/models/types/features/spaces/components/SpaceMembers";
export type { MemberAction } from "@/models/types/features/spaces/components/SpaceMembers";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Ellipsis, Mail, RotateCcw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Card } from "@/ui";
import { Checkbox } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import { Input } from "@/ui";
import { Skeleton } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceMember } from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

export function SpaceMembers({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [memberAction, setMemberAction] = useState<MemberAction>();
  const [actionBusy, setActionBusy] = useState(false);
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const { membersBySpace, loading, error, invite, removeMember, transferOwner, clearError } =
    useSpacesStore(
      useShallow((state) => ({
        membersBySpace: state.membersBySpace,
        loading: state.loading,
        error: state.error,
        invite: state.invite,
        removeMember: state.removeMember,
        transferOwner: state.transferOwner,
        clearError: state.clearError,
      })),
    );
  const members = membersBySpace[spaceId] ?? [];
  const [membersLoading] = useMinimumSpin(loading && members.length === 0);
  const owner = space?.role === "owner";
  const canInvite = owner && members.length + (space?.pending_count ?? 0) < 5;

  const closeInvite = useCallback(() => {
    if (inviting) return;
    setInviteOpen(false);
    setInviteEmail("");
    clearError();
  }, [clearError, inviting]);
  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    try {
      await invite(spaceId, email);
      setInviteEmail("");
      setInviteOpen(false);
    } catch {
      // The shared store error is rendered in the dialog.
    } finally {
      setInviting(false);
    }
  };
  const confirmMemberAction = async () => {
    if (!memberAction || actionBusy) return;
    setActionBusy(true);
    clearError();
    try {
      if (memberAction.kind === "transfer")
        await transferOwner(spaceId, memberAction.member.user_id);
      else await removeMember(spaceId, memberAction.member.user_id);
      setMemberAction(undefined);
    } catch {
      // The shared store error remains visible in the confirmation dialog.
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-auto bg-background px-5 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-sm font-semibold text-foreground">People with access</h2>
            <p className="mb-0 mt-1 text-xs text-muted-foreground">
              {members.length} active member{members.length === 1 ? "" : "s"}
              {space?.pending_count ? ` · ${space.pending_count} pending` : ""}
            </p>
          </div>
          {canInvite ? (
            <Button
              type="button"
              onClick={() => {
                clearError();
                setInviteOpen(true);
              }}
            >
              <UserPlus className="size-4" /> Invite member
            </Button>
          ) : null}
        </div>

        {error && !inviteOpen && !memberAction ? (
          <Button
            className="mb-3 h-auto w-full justify-start whitespace-normal rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/15 hover:text-destructive"
            variant="ghost"
            type="button"
            onClick={clearError}
          >
            {error}
          </Button>
        ) : null}

        <Card className="overflow-hidden" aria-label="Space members">
          {membersLoading ? (
            <div aria-busy="true" role="status">
              <span className="sr-only">Loading members</span>
              {[0, 1, 2, 3].map((index) => (
                <div
                  className={`flex min-h-[72px] min-w-0 items-center gap-3 px-4 py-3 ${index ? "border-t border-border/60" : ""}`}
                  key={index}
                >
                  <Skeleton className="size-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 grid gap-2">
                    <Skeleton className="h-3.5 w-32 rounded" />
                    <Skeleton className="h-3 w-44 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            members.map((member, index) => (
              <div
                className={[
                  "group flex min-h-[72px] min-w-0 items-center gap-3 px-4 py-3",
                  "transition-colors hover:bg-muted/50",
                  index ? "border-t border-border/60" : "",
                ].join(" ")}
                key={member.user_id}
              >
                <Avatar className="size-10 shrink-0">
                  <AvatarFallback className="text-xs font-semibold">
                    {memberInitials(member.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="m-0 truncate text-sm font-medium text-foreground">
                      {member.name}
                    </p>
                    {member.user_id === user?.id ? <Badge variant="secondary">You</Badge> : null}
                  </div>
                  <p className="mb-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <Mail className="size-3 shrink-0" /> {member.email}
                  </p>
                </div>
                <Badge className="hidden capitalize sm:inline-flex" variant="outline">
                  {member.role}
                </Badge>
                {owner && member.role !== "owner" ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <MemberPermissionControls
                      spaceId={spaceId}
                      userId={member.user_id}
                      memberName={member.name}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          type="button"
                          aria-label={`Actions for ${member.name}`}
                        >
                          <Ellipsis className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setMemberAction({ kind: "transfer", member })}
                        >
                          <ShieldCheck className="mr-2 size-4" /> Transfer ownership
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setMemberAction({ kind: "remove", member })}
                        >
                          <Trash2 className="mr-2 size-4" /> Remove member
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            ))
          )}
          {!membersLoading && !members.length ? (
            <div className="grid min-h-56 place-items-center p-6 text-center">
              <div>
                <Users className="mx-auto size-6 text-muted-foreground" />
                <p className="mb-0 mt-3 text-sm font-medium">No members loaded</p>
                <p className="mb-0 mt-1 text-xs text-muted-foreground">
                  Members will appear when access data is available.
                </p>
              </div>
            </div>
          ) : null}
        </Card>

        {owner && space?.is_personal ? (
          <Card className="mt-4 bg-muted/30 p-4 shadow-none ring-0">
            <h3 className="m-0 text-sm font-medium">Your default Space</h3>
            <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
              This Space can be renamed but cannot be deleted or transferred. It remains private
              until you invite someone.
            </p>
          </Card>
        ) : null}
      </div>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => (open ? setInviteOpen(true) : closeInvite())}
      >
        <DialogContent className="max-w-sm">
          <form onSubmit={(event) => void submitInvite(event)}>
            <DialogHeader>
              <DialogTitle>Invite to {space?.name ?? "Space"}</DialogTitle>
              <DialogDescription>
                Invite someone with an existing Misty account. The invitation expires after seven
                days.
              </DialogDescription>
            </DialogHeader>
            <label className="mt-5 grid gap-2 text-xs font-medium text-muted-foreground">
              Email address
              <Input
                autoFocus
                type="email"
                autoComplete="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </label>
            {error ? (
              <p
                className="mb-0 mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <DialogFooter className="mt-5">
              <Button variant="outline" type="button" disabled={inviting} onClick={closeInvite}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(memberAction)}
        onOpenChange={(open) => !open && !actionBusy && setMemberAction(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {memberAction?.kind === "transfer"
                ? "Transfer Space ownership?"
                : "Remove this member?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {memberAction?.kind === "transfer"
                ? `${memberAction.member.name} will become the owner and control membership and Space settings.`
                : `${memberAction?.member.name ?? "This member"} will immediately lose access to this Space.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p
              className="m-0 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                memberAction?.kind === "remove"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
              disabled={actionBusy}
              onClick={(event) => {
                event.preventDefault();
                void confirmMemberAction();
              }}
            >
              {actionBusy
                ? "Working…"
                : memberAction?.kind === "transfer"
                  ? "Transfer ownership"
                  : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemberPermissionControls({
  spaceId,
  userId,
  memberName,
}: {
  spaceId: string;
  userId: string;
  memberName: string;
}) {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [savingPermission, setSavingPermission] = useState("");
  const [loadError, setLoadError] = useState("");
  const loadPermissions = useCallback(async () => {
    setLoadError("");
    try {
      setPermissions((await spacesApi.memberPermissions(spaceId, userId)).permissions);
    } catch {
      setLoadError("Could not load permissions.");
    }
  }, [spaceId, userId]);
  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);
  const setPermission = async (permission: string, effect: "allow" | "deny" | "inherit") => {
    setSavingPermission(permission);
    setLoadError("");
    try {
      setPermissions(
        (await spacesApi.setMemberPermission(spaceId, userId, permission, effect)).permissions,
      );
    } catch {
      setLoadError("Could not update permissions.");
      await loadPermissions();
    } finally {
      setSavingPermission("");
    }
  };
  const resetDefaults = async () => {
    setSavingPermission("defaults");
    setLoadError("");
    try {
      let latest = permissions;
      for (const group of permissionGroups)
        for (const item of group.items)
          latest = (await spacesApi.setMemberPermission(spaceId, userId, item.id, "inherit"))
            .permissions;
      setPermissions(latest);
    } catch {
      setLoadError("Could not restore the Space defaults.");
      await loadPermissions();
    } finally {
      setSavingPermission("");
    }
  };
  const enabledCount = Object.values(permissions).filter(Boolean).length;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!savingPermission || nextOpen) setOpen(nextOpen);
      }}
    >
      <Button
        className="hidden sm:inline-flex"
        size="sm"
        variant="outline"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Manage permissions for ${memberName}`}
      >
        <ShieldCheck className="size-3.5" />
        Permissions
      </Button>
      <Button
        className="sm:hidden"
        size="icon"
        variant="ghost"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Manage permissions for ${memberName}`}
      >
        <ShieldCheck className="size-4" />
      </Button>
      <DialogContent className="flex max-h-[min(820px,calc(100vh-32px))] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4 text-left sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>Permissions for {memberName}</DialogTitle>
            {Object.keys(permissions).length ? (
              <Badge variant="outline">{enabledCount} enabled</Badge>
            ) : null}
          </div>
          <DialogDescription>
            Changes apply immediately. Dependent actions switch off when their required permission
            is unavailable.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-auto p-4 sm:p-5">
          {loadError ? (
            <p
              className="mb-4 mt-0 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {loadError}
            </p>
          ) : null}
          {!Object.keys(permissions).length ? (
            <Card className="grid min-h-56 place-items-center bg-muted/30 shadow-none ring-0">
              <Button variant="outline" type="button" onClick={() => void loadPermissions()}>
                Load permissions
              </Button>
            </Card>
          ) : (
            <div className="grid items-start gap-3 md:grid-cols-2">
              {permissionGroups.map((group) => (
                <PermissionGroup
                  key={group.title}
                  group={group}
                  permissions={permissions}
                  savingPermission={savingPermission}
                  onSet={setPermission}
                />
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="mt-0 flex-row justify-between gap-3 border-t border-border/60 px-4 py-3 sm:px-5">
          <Button
            variant="outline"
            type="button"
            disabled={Boolean(savingPermission) || !Object.keys(permissions).length}
            onClick={() => void resetDefaults()}
          >
            <RotateCcw className="size-3.5" />
            {savingPermission === "defaults" ? "Restoring…" : "Use Space defaults"}
          </Button>
          <Button type="button" disabled={Boolean(savingPermission)} onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionGroup({
  group,
  permissions,
  savingPermission,
  onSet,
}: {
  group: (typeof permissionGroups)[number];
  permissions: Record<string, boolean>;
  savingPermission: string;
  onSet: (permission: string, effect: "allow" | "deny" | "inherit") => Promise<void>;
}) {
  const groupEnabledCount = group.items.filter((item) => permissions[item.id]).length;
  return (
    <Card className="overflow-hidden">
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border/60 px-3.5">
        <h3 className="m-0 text-xs font-semibold">{group.title}</h3>
        <Badge variant="secondary">
          {groupEnabledCount}/{group.items.length}
        </Badge>
      </header>
      <div>
        {group.items.map((item) => {
          const blocked = permissionBlockedByParent(permissions, item.id);
          return (
            <label
              className={`flex min-h-[58px] items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-0 ${blocked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/70"}`}
              key={item.id}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{item.label}</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                  {item.description}
                </span>
                {blocked ? (
                  <span className="mt-1 block text-[9px] text-amber-500">
                    Requires the related parent permission.
                  </span>
                ) : null}
              </span>
              {savingPermission === item.id ? (
                <span className="text-[9px] text-muted-foreground">Saving…</span>
              ) : (
                <Checkbox
                  checked={Boolean(permissions[item.id])}
                  disabled={Boolean(savingPermission) || blocked}
                  onCheckedChange={(checked) => void onSet(item.id, checked ? "allow" : "deny")}
                />
              )}
            </label>
          );
        })}
      </div>
    </Card>
  );
}

function memberInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
function permissionBlockedByParent(permissions: Record<string, boolean>, permission: string) {
  if (permission === "messages.write") return !permissions["messages.read"];
  if (permission === "attachments.upload")
    return !permissions["messages.read"] || !permissions["messages.write"];
  if (permission === "tasks.manage") return !permissions["tasks.view"];
  return false;
}

const permissionGroups = [
  {
    title: "Chat",
    items: [
      {
        id: "messages.read",
        label: "Read messages",
        description: "Open the shared conversation and download attachments.",
      },
      {
        id: "messages.write",
        label: "Send and manage messages",
        description: "Send, reply, edit, or remove permitted messages.",
      },
      {
        id: "attachments.upload",
        label: "Upload chat attachments",
        description: "Attach new files to Space messages.",
      },
    ],
  },
  {
    title: "Library",
    items: [
      {
        id: "library.view",
        label: "View Library",
        description: "Browse items and metadata in this Space.",
      },
      {
        id: "library.upload",
        label: "Upload files",
        description: "Create uploads in Space storage.",
      },
      {
        id: "library.add",
        label: "Add Library items",
        description: "Add uploaded files and links to the Library.",
      },
      {
        id: "library.edit",
        label: "Organize and edit",
        description: "Edit metadata and Library organization.",
      },
      {
        id: "library.download",
        label: "Copy items",
        description: "Copy Library items to Files or the clipboard.",
      },
      {
        id: "library.import",
        label: "Import items",
        description: "Copy shared items into this Space.",
      },
    ],
  },
  {
    title: "Tasks and integrations",
    items: [
      {
        id: "tasks.view",
        label: "View tasks and calendars",
        description: "See shared tasks and published events.",
      },
      {
        id: "tasks.manage",
        label: "Manage tasks",
        description: "Create, assign, update, and archive tasks.",
      },
      {
        id: "integrations.manage",
        label: "Manage integrations",
        description: "Connect providers and publish resources.",
      },
    ],
  },
  {
    title: "Storage",
    items: [
      {
        id: "storage.view_own_usage",
        label: "View own storage usage",
        description: "See storage attributed to this member.",
      },
      {
        id: "storage.view_member_usage",
        label: "View member storage usage",
        description: "See storage attributed to other members.",
      },
      {
        id: "storage.manage",
        label: "Manage storage",
        description: "Manage Space-wide storage and recovery.",
      },
    ],
  },
] as const;
