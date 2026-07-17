import { useEffect, useState, type FormEvent } from "react";
import { Trash2, UserPlus, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../auth/AuthContext";
import { confirmAction } from "../../../shared/confirmAction";
import { spacesApi } from "../../../spaces/api";
import { useSpacesStore } from "../../../stores/useSpacesStore";

export function SpaceMembers({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const { membersBySpace, error, invite, removeMember, leaveSpace, transferOwner, deleteSpace, clearError } = useSpacesStore(useShallow((state) => ({
    membersBySpace: state.membersBySpace, error: state.error, invite: state.invite, removeMember: state.removeMember, leaveSpace: state.leaveSpace, transferOwner: state.transferOwner, deleteSpace: state.deleteSpace, clearError: state.clearError,
  })));
  const members = membersBySpace[spaceId] ?? [];
  const owner = space?.role === "owner";
  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    try { await invite(spaceId, email); setInviteEmail(""); setInviteOpen(false); }
    catch { /* the shared store error is rendered above the section */ }
    finally { setInviting(false); }
  };
  return <div className="h-full min-h-0 overflow-auto px-6 py-5">
    <div className="mb-5 flex items-center justify-between"><div><h3 className="m-0 text-base">Members</h3><p className="m-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{space?.is_shared ? `Shared with ${members.length} people${space.pending_count ? ` · ${space.pending_count} pending` : ""}` : "Private · invite someone to share this Space"} · 5 people maximum</p></div>{owner && members.length + (space?.pending_count ?? 0) < 5 ? <button className={primaryButtonClass} type="button" onClick={() => { clearError(); setInviteOpen(true); }}><UserPlus size={15}/>Invite</button> : null}</div>
    <div className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)]">{members.map((member) => <article className="flex min-h-16 items-center gap-3 border-b border-[var(--misty-border-soft)] px-4 last:border-0" key={member.user_id}><span className="grid size-9 place-items-center rounded-full bg-[var(--misty-surface-3)] text-xs font-semibold">{member.name.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="m-0 truncate text-sm font-medium">{member.name}{member.user_id === user?.id ? " (you)" : ""}</p><p className="m-0 truncate text-[11px] text-[var(--misty-text-subtle)]">{member.email}</p></div><span className="rounded-lg bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] capitalize text-[var(--misty-text-muted)]">{member.role}</span>{owner && member.role !== "owner" ? <><MemberPermissionControls spaceId={spaceId} userId={member.user_id}/><button className={smallButtonClass} type="button" onClick={() => void confirmAction(`Make ${member.name} the owner?`).then((confirmed) => { if (confirmed) return transferOwner(spaceId, member.user_id); })}>Transfer</button><button className={rowActionClass} type="button" onClick={() => void confirmAction(`Remove ${member.name} from this Space?`).then((confirmed) => { if (confirmed) return removeMember(spaceId, member.user_id); })}><Trash2 size={14}/></button></> : null}</article>)}</div>
    {owner && space?.is_personal ? <section className="mt-8 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4"><h4 className="m-0 text-sm">Your default Space</h4><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">This Space can be renamed, but cannot be deleted or transferred. It remains private until you invite someone, and you can remove members again at any time.</p></section> : owner ? <section className="mt-8 rounded-2xl border border-red-500/20 bg-red-950/10 p-4"><h4 className="m-0 text-sm text-red-200">Delete Space</h4><p className="mb-3 mt-1 text-xs leading-relaxed text-red-200/60">Removes access immediately and schedules permanent deletion after recovery and storage safety checks. The Space continues using an ownership slot until deletion finishes.</p><button className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200" type="button" onClick={() => { const confirmation = window.prompt(`Type “${space?.name ?? ""}” to schedule this Space for deletion.`); if (space && confirmation === space.name) void deleteSpace(spaceId, confirmation).then(() => window.location.assign("/spaces/personal")); }}>Delete Space</button></section> : <section className="mt-8 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4"><h4 className="m-0 text-sm">Leave Space</h4><p className="mb-3 mt-1 text-xs text-[var(--misty-text-subtle)]">You will immediately lose access to chat and protected Library items.</p><button className={secondaryButtonClass} type="button" onClick={() => void confirmAction(`Leave ${space?.name ?? "this Space"}?`).then((confirmed) => { if (confirmed) return leaveSpace(spaceId).then(() => window.location.assign("/spaces/personal")); })}>Leave Space</button></section>}
    {inviteOpen ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !inviting) setInviteOpen(false); }}><form className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-modal-bg,var(--misty-surface))] p-5 shadow-2xl" onSubmit={(event) => void submitInvite(event)}><div className="flex items-start justify-between gap-4"><div><h2 className="m-0 text-base font-semibold">Invite to {space?.name ?? "Space"}</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">Invitations work with an existing Misty account and expire after seven days.</p></div><button className={iconButtonClass} type="button" disabled={inviting} onClick={() => setInviteOpen(false)} aria-label="Close invite"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Email address<input className={inputClass} autoFocus type="email" autoComplete="email" placeholder="teammate@example.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)}/></label>{error ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">{error}</p> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={inviting} onClick={() => setInviteOpen(false)}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={inviting || !inviteEmail.trim()}>{inviting ? "Sending…" : "Send invite"}</button></div></form></div> : null}
  </div>;
}

function MemberPermissionControls({ spaceId, userId }: { spaceId: string; userId: string }) {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { let current = true; void spacesApi.memberPermissions(spaceId, userId).then((result) => current && setPermissions(result.permissions)).catch(() => undefined); return () => { current = false; }; }, [spaceId, userId]);
  const setMany = async (names: string[], allowed: boolean) => { setSaving(true); try { let latest = permissions; for (const permission of names) latest = (await spacesApi.setMemberPermission(spaceId, userId, permission, allowed ? "allow" : "deny")).permissions; setPermissions(latest); } finally { setSaving(false); } };
  const contribute = Boolean(permissions["library.upload"] && permissions["attachments.upload"] && permissions["library.add"]);
  const studioAccess = Boolean(permissions["studio.view"] && permissions["studio.manage"] && permissions["agents.run"]);
  return <div className="flex gap-1"><button className={smallButtonClass} type="button" disabled={saving} onClick={() => void setMany(["library.upload", "attachments.upload", "library.add"], !contribute)}>{contribute ? "Can contribute" : "Read only"}</button><button className={smallButtonClass} type="button" disabled={saving} onClick={() => void spacesApi.setMemberPermission(spaceId, userId, "library.edit", permissions["library.edit"] ? "deny" : "allow").then((result) => setPermissions(result.permissions))}>{permissions["library.edit"] ? "Can organize" : "No edits"}</button><button className={smallButtonClass} type="button" disabled={saving} onClick={() => void setMany(["studio.view", "studio.manage", "agents.run"], !studioAccess)}>{studioAccess ? "Can use Studio" : "No Studio"}</button></div>;
}

const iconButtonClass = "grid size-8 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)]";
const smallButtonClass = "inline-flex items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs text-[var(--misty-text)]";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)]";
const rowActionClass = "invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";
