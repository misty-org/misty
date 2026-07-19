import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Check, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useDialogFocus } from "../../../shared/hooks/useDialogFocus";
import { useSpacesStore } from "../../../stores/useSpacesStore";
import { SpacePanelContent } from "./SpacePanelContent";

export default function SpacesShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const createDialogTriggerRef = useRef<HTMLElement | null>(null);
  const createDialog = useDialogFocus<HTMLFormElement>(createOpen, createDialogTriggerRef);
  const [panelVisible, setPanelVisible] = useState(() => {
    try { return window.localStorage.getItem("misty:spaces-panel-visible") !== "false"; }
    catch { return true; }
  });
  const { spaces, invitations, limits, loading, error, load, createSpace, respondInvite, clearError } = useSpacesStore(useShallow((state) => ({
    spaces: state.spaces,
    invitations: state.invitations,
    limits: state.limits,
    loading: state.loading,
    error: state.error,
    load: state.load,
    createSpace: state.createSpace,
    respondInvite: state.respondInvite,
    clearError: state.clearError,
  })));
  const detailRouteActive = location.pathname.split("/").filter(Boolean).length >= 3;

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    try { window.localStorage.setItem("misty:spaces-panel-visible", String(panelVisible)); }
    catch { /* storage can be unavailable in private contexts */ }
  }, [panelVisible]);

  const closeCreateDialog = () => {
    if (creating) return;
    clearError();
    setCreateOpen(false);
    setCreateName("");
  };
  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = createName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await createSpace(name);
      setCreateName("");
      setCreateOpen(false);
      navigate(`/spaces/${encodeURIComponent(created.id)}/library`);
    } catch { /* the dialog renders the store error */ }
    finally { setCreating(false); }
  };
  return <div className={`grid h-full min-h-0 grid-rows-[minmax(0,1fr)_26px] overflow-hidden bg-transparent ${panelVisible ? "grid-cols-[232px_minmax(0,1fr)] max-[900px]:grid-cols-[196px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"}`}>
    {panelVisible ? <aside className="col-start-1 row-start-1 min-h-0 overflow-auto border-r border-[var(--misty-divider-subtle)] bg-transparent px-3 py-4">
      {error && !detailRouteActive && !createOpen ? <button className="mb-3 w-full rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-[11px] leading-relaxed text-red-200" type="button" onClick={clearError}>{error}</button> : null}
      <SpacePanelContent spaces={spaces} limits={limits} loading={loading} onAddSpace={(trigger) => { createDialogTriggerRef.current = trigger; clearError(); setCreateOpen(true); }}/>
      {invitations.length > 0 ? <section className="mt-5 border-t border-[var(--misty-border-soft)] pt-4"><p className="mb-2 px-2 text-[10px] font-semibold capitalize text-[var(--misty-text-subtle)]">Invitations</p>{invitations.map((invite) => <article key={invite.id} className="mb-2 rounded-xl bg-[var(--misty-surface-2)] p-2.5 text-xs"><p className="m-0 truncate font-medium">{invite.space_name}</p><div className="mt-2 flex gap-1.5"><button className={smallButtonClass} type="button" onClick={() => void respondInvite(invite.id, true)}><Check size={13}/>Accept</button><button className={smallButtonClass} type="button" onClick={() => void respondInvite(invite.id, false)}>Decline</button></div></article>)}</section> : null}
    </aside> : null}
    <main className={`${panelVisible ? "col-start-2" : "col-start-1"} row-start-1 min-h-0 min-w-0 bg-transparent`}><Outlet/></main>
    <footer className="col-span-full row-start-2 flex min-h-[26px] items-center border-t border-[var(--misty-divider-subtle)] bg-transparent px-2"><button className={`grid h-5 w-[22px] place-items-center rounded border-0 p-0 text-[var(--misty-text-subtle)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)] ${panelVisible ? "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-selected))] text-[var(--misty-text)]" : "bg-transparent"}`} type="button" onClick={() => setPanelVisible((visible) => !visible)} title={panelVisible ? "Hide Spaces panel" : "Show Spaces panel"} aria-label={panelVisible ? "Hide Spaces panel" : "Show Spaces panel"} aria-pressed={panelVisible}>{panelVisible ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}</button></footer>
    {createOpen ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeCreateDialog(); }}><form ref={createDialog.dialogRef} className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="create-space-title" aria-describedby="create-space-description" onKeyDown={(event) => { if (event.key === "Escape" && !creating) { event.preventDefault(); closeCreateDialog(); } else createDialog.trapFocus(event); }} onSubmit={(event) => void onCreate(event)}><div className="flex items-start justify-between gap-4"><div><h2 className="m-0 text-base font-semibold" id="create-space-title">Create a Space</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]" id="create-space-description">It starts private. You can own three Spaces total, including your personal Space.</p></div><button className={iconButtonClass} type="button" disabled={creating} onClick={closeCreateDialog} aria-label="Close create Space dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Space name<input className={inputClass} data-dialog-autofocus maxLength={80} placeholder="Design team" value={createName} onChange={(event) => setCreateName(event.target.value)}/></label><p className="mb-0 mt-3 text-[11px] text-[var(--misty-text-subtle)]">{limits ? `${limits.owned} of ${limits.owned_limit} ownership slots used · ${limits.remaining_owned} remaining` : "Checking ownership slots…"}</p>{error ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">{error}</p> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={creating} onClick={closeCreateDialog}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={creating || !createName.trim()}>{creating ? "Creating…" : "Create Space"}</button></div></form></div> : null}
  </div>;
}

export function PersonalSpaceRedirect() {
  const { spaces, loading, error, load, clearError } = useSpacesStore(useShallow((state) => ({ spaces: state.spaces, loading: state.loading, error: state.error, load: state.load, clearError: state.clearError })));
  const personal = spaces.find((space) => space.is_personal);
  const attemptedLoad = useRef(false);
  useEffect(() => {
    if (!personal && !loading && !attemptedLoad.current) {
      attemptedLoad.current = true;
      void load();
    }
  }, [load, loading, personal]);
  if (personal) return <Navigate to={`/spaces/${encodeURIComponent(personal.id)}/library`} replace/>;
  if (error && !loading) return <div className="grid h-full place-items-center px-6 text-center"><div><p className="m-0 text-sm text-[var(--misty-text-muted)]">{error}</p><button className={`${secondaryButtonClass} mt-4`} type="button" onClick={() => { attemptedLoad.current = false; clearError(); void load(); }}>Try again</button></div></div>;
  return <div className="grid h-full place-items-center text-sm text-[var(--misty-text-muted)]">Loading your personal Space…</div>;
}

const iconButtonClass = "grid size-8 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)]";
const smallButtonClass = "inline-flex items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs text-[var(--misty-text)]";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)]";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";
