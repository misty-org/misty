import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RotateCcw, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../auth/AuthContext";
import { confirmAction } from "../../../shared/confirmAction";
import { useDialogFocus } from "../../../shared/hooks/useDialogFocus";
import { spacesApi } from "../../../spaces/api";
import { useSpacesStore } from "../../../stores/useSpacesStore";

export function SpaceMembers({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const inviteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const inviteDialog = useDialogFocus<HTMLFormElement>(inviteOpen, inviteTriggerRef);
  const deleteDialog = useDialogFocus<HTMLFormElement>(deleteOpen, deleteTriggerRef);
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const { membersBySpace, error, invite, removeMember, leaveSpace, transferOwner, deleteSpace, clearError } = useSpacesStore(useShallow((state) => ({
    membersBySpace: state.membersBySpace, error: state.error, invite: state.invite, removeMember: state.removeMember, leaveSpace: state.leaveSpace, transferOwner: state.transferOwner, deleteSpace: state.deleteSpace, clearError: state.clearError,
  })));
  const members = membersBySpace[spaceId] ?? [];
  const owner = space?.role === "owner";
  const closeInvite = useCallback(() => {
    if (inviting) return;
    setInviteOpen(false);
    setInviteEmail("");
    clearError();
  }, [clearError, inviting]);
  const closeDelete = useCallback(() => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeleteConfirmation("");
    clearError();
  }, [clearError, deleting]);
  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    try { await invite(spaceId, email); setInviteEmail(""); setInviteOpen(false); }
    catch { /* the shared store error is rendered above the section */ }
    finally { setInviting(false); }
  };
  const submitDelete = async (event: FormEvent) => {
    event.preventDefault();
    if (!space || deleting || deleteConfirmation !== space.name) return;
    setDeleting(true);
    try {
      await deleteSpace(spaceId, deleteConfirmation);
      navigate("/spaces/personal", { replace: true });
    } catch { /* the shared store error is rendered in the dialog */ }
    finally { setDeleting(false); }
  };
  useEffect(() => {
    if (!inviteOpen && !deleteOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || inviting || deleting) return;
      if (inviteOpen) closeInvite();
      if (deleteOpen) closeDelete();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDelete, closeInvite, deleteOpen, deleting, inviteOpen, inviting]);
  return <div className="h-full min-h-0 overflow-auto px-5 py-5 sm:px-6">
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-base font-semibold text-[var(--misty-text)]">Members <span className="ml-1 text-[10px] font-normal text-[var(--misty-text-subtle)]">{members.length}{space?.pending_count ? ` + ${space.pending_count}` : ""}</span></h1>
        {owner && members.length + (space?.pending_count ?? 0) < 5 ? <button ref={inviteTriggerRef} className={primaryButtonClass} type="button" onClick={() => { clearError(); setInviteOpen(true); }}><UserPlus size={15}/>Invite</button> : null}
      </header>

      <section className="grid gap-2" aria-label="Space members">
        {members.map((member) => <article className="group flex min-h-[72px] min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] px-3.5 py-3 shadow-sm transition-[border-color,background-color] hover:border-[var(--misty-border-strong)] hover:bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))]" key={member.user_id}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--misty-divider-default)] bg-[var(--misty-surface-3)] text-xs font-semibold text-[var(--misty-text)]">{member.name.slice(0,2).toUpperCase()}</span>
          <div className="min-w-40 flex-1">
            <p className="m-0 truncate text-sm font-semibold text-[var(--misty-text)]">{member.name}{member.user_id === user?.id ? " (you)" : ""}</p>
            <p className="mb-0 mt-0.5 truncate text-[11px] text-[var(--misty-text-subtle)]">{member.email}</p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--misty-divider-default)] bg-[var(--misty-surface-2)] px-2.5 py-1 text-[10px] font-medium capitalize text-[var(--misty-text-muted)]">{member.role}</span>
          {owner && member.role !== "owner" ? <div className="flex shrink-0 items-center gap-1.5 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><MemberPermissionControls spaceId={spaceId} userId={member.user_id} memberName={member.name}/><button className={smallButtonClass} type="button" onClick={() => void confirmAction(`Make ${member.name} the owner?`).then((confirmed) => { if (confirmed) return transferOwner(spaceId, member.user_id); })} aria-label={`Transfer ownership to ${member.name}`}>Transfer</button><button className={rowActionClass} type="button" onClick={() => void confirmAction(`Remove ${member.name} from this Space?`).then((confirmed) => { if (confirmed) return removeMember(spaceId, member.user_id); })} aria-label={`Remove ${member.name}`} title={`Remove ${member.name}`}><Trash2 size={14}/></button></div> : null}
        </article>)}
      </section>

      {owner && space?.is_personal ? <section className={`${supportCardClass} mt-5`}><div><h2 className="m-0 text-sm font-semibold">Your default Space</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">This Space can be renamed, but cannot be deleted or transferred. It remains private until you invite someone.</p></div></section> : owner ? <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-950/10 p-4"><div className="min-w-0 max-w-3xl"><h2 className="m-0 text-sm font-semibold text-red-200">Delete Space</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-red-200/60">Removes access immediately and schedules permanent deletion after recovery and storage safety checks.</p></div><button ref={deleteTriggerRef} className={dangerButtonClass} type="button" onClick={() => { clearError(); setDeleteConfirmation(""); setDeleteOpen(true); }}>Delete Space</button></section> : <section className={`${supportCardClass} mt-5 flex-wrap justify-between gap-4`}><div><h2 className="m-0 text-sm font-semibold">Leave Space</h2><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">You will immediately lose access to chat and protected Library items.</p></div><button className={secondaryButtonClass} type="button" onClick={() => void confirmAction(`Leave ${space?.name ?? "this Space"}?`).then((confirmed) => { if (confirmed) return leaveSpace(spaceId).then(() => navigate("/spaces/personal", { replace: true })); })}>Leave Space</button></section>}
    </div>
    {inviteOpen ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeInvite(); }}><form ref={inviteDialog.dialogRef} className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="space-invite-title" aria-describedby="space-invite-description" onKeyDown={inviteDialog.trapFocus} onSubmit={(event) => void submitInvite(event)}><div className="flex items-start justify-between gap-4"><div><h2 className="m-0 text-base font-semibold" id="space-invite-title">Invite to {space?.name ?? "Space"}</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]" id="space-invite-description">Invitations work with an existing Misty account and expire after seven days.</p></div><button className={iconButtonClass} type="button" disabled={inviting} onClick={closeInvite} aria-label="Close invite"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Email address<input className={inputClass} data-dialog-autofocus type="email" autoComplete="email" placeholder="teammate@example.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)}/></label>{error ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">{error}</p> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={inviting} onClick={closeInvite}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={inviting || !inviteEmail.trim()}>{inviting ? "Sending…" : "Send invite"}</button></div></form></div> : null}
    {deleteOpen && space ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeDelete(); }}><form ref={deleteDialog.dialogRef} className="w-full max-w-sm rounded-2xl border border-red-400/25 bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="space-delete-title" aria-describedby="space-delete-description" onKeyDown={deleteDialog.trapFocus} onSubmit={(event) => void submitDelete(event)}><div className="flex items-start justify-between gap-4"><div><h2 className="m-0 text-base font-semibold text-red-200" id="space-delete-title">Delete {space.name}</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]" id="space-delete-description">This immediately removes member access and schedules permanent deletion. Type the Space name exactly to continue.</p></div><button className={iconButtonClass} type="button" disabled={deleting} onClick={closeDelete} aria-label="Close delete Space dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Space name<input className={inputClass} data-dialog-autofocus autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)}/></label>{error ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">{error}</p> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={deleting} onClick={closeDelete}>Cancel</button><button className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3 text-xs text-red-200 disabled:opacity-50" type="submit" disabled={deleting || deleteConfirmation !== space.name}>{deleting ? "Deleting…" : "Delete Space"}</button></div></form></div> : null}
  </div>;
}

function MemberPermissionControls({ spaceId, userId, memberName }: { spaceId: string; userId: string; memberName: string }) {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [savingPermission, setSavingPermission] = useState("");
  const [loadError, setLoadError] = useState("");
  const permissionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const permissionDialog = useDialogFocus<HTMLElement>(open, permissionTriggerRef);
  const loadPermissions = useCallback(async () => {
    setLoadError("");
    try { setPermissions((await spacesApi.memberPermissions(spaceId, userId)).permissions); }
    catch { setLoadError("Could not load permissions."); }
  }, [spaceId, userId]);
  useEffect(() => { void loadPermissions(); }, [loadPermissions]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !savingPermission) setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, savingPermission]);
  const setPermission = async (permission: string, effect: "allow" | "deny" | "inherit") => {
    setSavingPermission(permission); setLoadError("");
    try { setPermissions((await spacesApi.setMemberPermission(spaceId, userId, permission, effect)).permissions); }
    catch { setLoadError("Could not update permissions."); await loadPermissions(); }
    finally { setSavingPermission(""); }
  };
  const resetDefaults = async () => {
    setSavingPermission("defaults"); setLoadError("");
    try {
      let latest = permissions;
      for (const group of permissionGroups) for (const item of group.items) latest = (await spacesApi.setMemberPermission(spaceId, userId, item.id, "inherit")).permissions;
      setPermissions(latest);
    } catch { setLoadError("Could not restore the Space defaults."); await loadPermissions(); }
    finally { setSavingPermission(""); }
  };
  const enabledCount = Object.values(permissions).filter(Boolean).length;
  return <>
    <button ref={permissionTriggerRef} className={smallButtonClass} type="button" onClick={() => setOpen(true)} aria-label={`Manage permissions for ${memberName}`}><ShieldCheck size={12}/>Permissions{Object.keys(permissions).length ? <span className="rounded-full bg-[var(--misty-surface-3)] px-1.5 py-0.5 text-[9px]">{enabledCount}</span> : null}</button>
    {open ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/70 p-4 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !savingPermission) setOpen(false); }}>
      <section ref={permissionDialog.dialogRef} className="flex max-h-[min(820px,calc(100vh-32px))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,#101114)] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby={`member-permissions-${userId}`} aria-describedby={`member-permissions-description-${userId}`} onKeyDown={permissionDialog.trapFocus}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--misty-border-soft)] px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-base font-semibold" id={`member-permissions-${userId}`}>Permissions for {memberName}</h2>{Object.keys(permissions).length ? <span className="rounded-full border border-[var(--misty-divider-default)] bg-[var(--misty-surface-2)] px-2 py-1 text-[9px] text-[var(--misty-text-muted)]">{enabledCount} enabled</span> : null}</div>
            <p className="mb-0 mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--misty-text-subtle)]" id={`member-permissions-description-${userId}`}>Changes apply immediately. Related actions switch off automatically when a required permission is unavailable.</p>
          </div>
          <button className={iconButtonClass} data-dialog-autofocus type="button" disabled={Boolean(savingPermission)} onClick={() => setOpen(false)} aria-label="Close member permissions"><X size={15}/></button>
        </header>

        <div className="min-h-0 overflow-auto p-4 sm:p-5">
          {loadError ? <p className="mb-4 mt-0 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs text-red-200" role="alert">{loadError}</p> : null}
          {!Object.keys(permissions).length ? <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-[var(--misty-border-strong)] text-xs text-[var(--misty-text-subtle)]"><button className={secondaryButtonClass} type="button" onClick={() => void loadPermissions()}>Load permissions</button></div> : <div className="grid items-start gap-3 md:grid-cols-2">{permissionGroups.map((group) => {
            const groupEnabledCount = group.items.filter((item) => permissions[item.id]).length;
            return <section className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))]" key={group.title}>
              <header className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--misty-border-soft)] px-3.5"><h3 className="m-0 text-xs font-semibold text-[var(--misty-text)]">{group.title}</h3><span className="rounded-full bg-[var(--misty-surface-2)] px-2 py-1 text-[9px] text-[var(--misty-text-subtle)]">{groupEnabledCount}/{group.items.length}</span></header>
              <div>{group.items.map((item) => { const parentBlocked = permissionBlockedByParent(permissions, item.id); return <label className={`flex min-h-[58px] items-center gap-3 border-b border-[var(--misty-border-soft)] px-3.5 py-2.5 last:border-0 ${parentBlocked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))]"}`} key={item.id}>
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-[var(--misty-text)]">{item.label}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--misty-text-subtle)]">{item.description}</span>{parentBlocked ? <span className="mt-1 block text-[9px] text-amber-200/75">Requires the related Chat permission.</span> : null}</span>
                {savingPermission === item.id ? <span className="shrink-0 text-[9px] text-[var(--misty-text-subtle)]">Saving…</span> : <input className="size-4 shrink-0 accent-[var(--misty-primary)]" type="checkbox" checked={Boolean(permissions[item.id])} disabled={Boolean(savingPermission) || parentBlocked} onChange={(event) => void setPermission(item.id, event.target.checked ? "allow" : "deny")}/>}</label>; })}</div>
            </section>;
          })}</div>}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--misty-border-soft)] bg-[var(--misty-app-modal-bg,#101114)] px-4 py-3 sm:px-5">
          <button className={secondaryButtonClass} type="button" disabled={Boolean(savingPermission) || !Object.keys(permissions).length} onClick={() => void resetDefaults()}><RotateCcw size={13}/>{savingPermission === "defaults" ? "Restoring…" : "Use Space defaults"}</button>
          <button className={primaryButtonClass} type="button" disabled={Boolean(savingPermission)} onClick={() => setOpen(false)}>Done</button>
        </footer>
      </section>
    </div> : null}
  </>;
}

function permissionBlockedByParent(permissions: Record<string, boolean>, permission: string) {
  if (permission === "messages.write") return !permissions["messages.read"];
  if (permission === "attachments.upload") return !permissions["messages.read"] || !permissions["messages.write"];
  if (permission === "tasks.manage") return !permissions["tasks.view"];
  return false;
}

const permissionGroups = [
  { title: "Chat", items: [
    { id: "messages.read", label: "Read messages", description: "Open this Space's shared conversation and download its attachments." },
    { id: "messages.write", label: "Send and manage messages", description: "Send messages, reply, and edit or remove permitted messages." },
    { id: "attachments.upload", label: "Upload chat attachments", description: "Attach new files to Space messages." },
  ] },
  { title: "Library", items: [
    { id: "library.view", label: "View Library", description: "Browse items and metadata in this Space." },
    { id: "library.upload", label: "Upload files", description: "Create uploads in Space storage." },
    { id: "library.add", label: "Add Library items", description: "Add uploaded files and links to the Library." },
    { id: "library.edit", label: "Organize and edit", description: "Edit metadata, albums, people, stacks, and Library organization." },
    { id: "library.download", label: "Copy items", description: "Copy Library items to Files or the system clipboard." },
    { id: "library.import", label: "Import from another Space", description: "Copy shared Library items into this Space." },
  ] },
  { title: "Studio and Agents", items: [
    { id: "studio.view", label: "View Studio", description: "See shared Agents, workflows, and run history." },
    { id: "studio.manage", label: "Manage Studio", description: "Create, edit, replace, and delete Agents and workflows." },
    { id: "agents.run", label: "Run Agents and workflows", description: "Start manual, chat, and automated Space Agent runs." },
  ] },
  { title: "Tasks and integrations", items: [
    { id: "tasks.view", label: "View tasks and calendars", description: "See shared tasks and explicitly published calendar events." },
    { id: "tasks.manage", label: "Manage tasks", description: "Create, assign, update, complete, and archive shared tasks." },
    { id: "integrations.manage", label: "Manage integrations", description: "Connect providers and publish selected resources into this Space." },
  ] },
  { title: "Storage", items: [
    { id: "storage.view_own_usage", label: "View own storage usage", description: "See storage attributed to this member." },
    { id: "storage.view_member_usage", label: "View member storage usage", description: "See storage attributed to other members." },
    { id: "storage.manage", label: "Manage storage", description: "Manage Space-wide storage and recovery operations." },
  ] },
] as const;

const iconButtonClass = "grid size-8 shrink-0 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)] transition-colors hover:bg-[var(--misty-surface-3)] disabled:opacity-45";
const smallButtonClass = "inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 text-[10px] font-medium text-[var(--misty-text-muted)] transition-colors hover:border-[var(--misty-border-strong)] hover:bg-[var(--misty-surface-3)] hover:text-[var(--misty-text)] disabled:opacity-45";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs font-medium text-[var(--misty-text)] transition-colors hover:border-[var(--misty-border-strong)] hover:bg-[var(--misty-surface-3)] disabled:opacity-45";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3.5 text-xs font-semibold text-[var(--misty-primary-contrast)] transition-colors hover:bg-[var(--misty-primary-hover)] disabled:opacity-45";
const dangerButtonClass = "inline-flex min-h-9 shrink-0 items-center rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 text-xs font-medium text-red-200 transition-colors hover:border-red-400/40 hover:bg-red-500/15";
const rowActionClass = "grid size-8 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] transition-colors hover:bg-red-500/10 hover:text-red-200";
const supportCardClass = "flex items-center rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";
