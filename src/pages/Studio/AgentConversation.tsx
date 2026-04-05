import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, LockKeyhole, Send, X } from "lucide-react";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import type { AgentConversation, AgentConversationEvent, RunAction, RunApproval, SpaceRun, SpaceStudioResource } from "../../spaces/types";
import { errorText } from "../../shared/format";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";

export function AgentConversationPanel({ agent, conversationId, embedded = false, returnFocusRef, onClose }: { agent: SpaceStudioResource; conversationId?: string; embedded?: boolean; returnFocusRef?: RefObject<HTMLElement | null>; onClose: () => void }) {
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [events, setEvents] = useState<AgentConversationEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [pendingRun, setPendingRun] = useState<SpaceRun | null>(null);
  const [latestRunDetail, setLatestRunDetail] = useState<{ run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] } | null>(null);
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const historyEndRef = useRef<HTMLDivElement | null>(null);
  const panelDialog = useDialogFocus<HTMLElement>(!embedded, returnFocusRef);

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    void agentArchitectureApi.conversations().then(async ({ conversations }) => {
      if (!active) return;
      const existing = conversations.find((item) => conversationId ? item.id === conversationId && item.agent_id === agent.id && item.space_id === agent.space_id : item.agent_id === agent.id && item.space_id === agent.space_id) ?? null;
      setConversation(existing);
      if (existing) await loadConversationState(existing.id, () => active, setEvents, setLatestRunDetail, setPendingRun, setError);
    }).catch((reason) => active && setError(errorText(reason))).finally(() => active && setHistoryLoading(false));
    return () => { active = false; };
  }, [agent.id, agent.space_id, conversationId]);
  useEffect(() => { historyEndRef.current?.scrollIntoView({ block: "nearest" }); }, [events.length, pendingRun?.id]);
  const ensureConversation = async () => {
    if (conversation) return conversation;
    const created = await agentArchitectureApi.createConversation(agent.space_id, agent.id, `Chat with ${agent.name}`);
    setConversation(created);
    return created;
  };
  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true); setError(""); setPrompt("");
    let target = conversation;
    try {
      target = await ensureConversation();
      const response = await agentArchitectureApi.sendConversationMessage(target.id, { prompt: text, input: { prompt: text } });
      setPendingRun(response.run?.state === "awaiting_approval" ? response.run : null);
      await loadConversationState(target.id, () => true, setEvents, setLatestRunDetail, setPendingRun, setError);
    } catch (reason) {
      setError(errorText(reason));
      const loaded = target ? await loadConversationState(target.id, () => true, setEvents, setLatestRunDetail, setPendingRun, () => undefined) : [];
      const lastUserMessage = [...loaded].reverse().find((event) => event.event_type === "user_message");
      if (lastUserMessage?.data.text !== text) setPrompt((current) => current || text);
    }
    finally { setBusy(false); }
  };
  const decide = async (approved: boolean) => {
    if (!pendingRun) return;
    setBusy(true);
    try { await agentArchitectureApi.decideRun(pendingRun.id, approved); setPendingRun(null); if (conversation) await loadConversationState(conversation.id, () => true, setEvents, setLatestRunDetail, setPendingRun, setError); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  const panel = <section ref={panelDialog.dialogRef} className={`grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto] bg-transparent ${embedded ? "" : "max-w-lg border-l border-[var(--misty-border-soft)] bg-[var(--misty-app-pane-bg,var(--misty-surface))] shadow-2xl"}`} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label={`Private conversation with ${agent.name}`} onKeyDown={(event) => { if (!embedded && event.key === "Escape" && !busy) { event.preventDefault(); onClose(); } else if (!embedded) panelDialog.trapFocus(event); }}>
    <header className="flex items-start justify-between border-b border-[var(--misty-border-soft)] p-4"><div><span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-[9px] font-semibold capitalize text-sky-200"><LockKeyhole size={11}/>Private To You</span><h2 className="mb-0 mt-2 text-base">{agent.name}</h2><p className="m-0 mt-1 text-[11px] text-[var(--misty-text-subtle)]">This conversation never appears in shared Space chat.</p></div><button className={iconButton} type="button" disabled={busy} onClick={onClose} aria-label="Close private conversation"><X size={15}/></button></header>
    <div className="min-h-0 overflow-auto p-4" aria-busy={historyLoading}>{historyLoading ? <div className="grid h-full place-items-center text-xs text-[var(--misty-text-subtle)]">Loading private history…</div> : events.length === 0 ? <div className="grid h-full place-items-center text-center"><div><LockKeyhole className="mx-auto text-sky-300"/><p className="mb-1 mt-3 text-sm">Start a private conversation</p><p className="m-0 max-w-xs text-[11px] leading-relaxed text-[var(--misty-text-subtle)]">Only you can open this thread. Every request still creates an isolated, auditable run.</p></div></div> : <div className="grid gap-2">{events.filter((event) => event.event_type.endsWith("message") || event.event_type === "error").map((event) => { const own = event.event_type === "user_message"; return <article className={`rounded-xl p-3 text-xs leading-relaxed ${own ? "ml-10 bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)]" : "mr-10 bg-[var(--misty-surface-2)]"}`} key={event.id}><div className={`mb-1 flex items-center justify-between gap-3 text-[9px] ${own ? "opacity-70" : "text-[var(--misty-text-subtle)]"}`}><span>{own ? "You" : agent.name}</span><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>{eventText(event)}</article>; })}<div ref={historyEndRef}/></div>}</div>
    <footer className="border-t border-[var(--misty-border-soft)] p-4">{latestRunDetail ? <section className="mb-3 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-3" aria-label="Latest Space Agent run"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="m-0 truncate text-[10px] font-medium">Latest run · {latestRunDetail.run.state.replace(/_/g, " ")}</p><p className="mb-0 mt-1 truncate text-[9px] text-[var(--misty-text-subtle)]">{latestRunDetail.run.capability_id} · {latestRunDetail.run.workflow_identifier}@{latestRunDetail.run.workflow_version}</p></div><button className={secondaryButton} type="button" aria-expanded={runDetailsOpen} onClick={() => setRunDetailsOpen((open) => !open)}>{runDetailsOpen ? "Hide" : "Inspect"}</button></div>{runDetailsOpen ? <div className="mt-3 grid gap-2 border-t border-[var(--misty-border-soft)] pt-3 text-[9px]"><p className="m-0 text-[var(--misty-text-subtle)]">Run {latestRunDetail.run.id} · source {latestRunDetail.run.source_type}</p>{latestRunDetail.actions.length ? <div><strong className="text-[var(--misty-text-muted)]">Actions</strong><ul className="mb-0 mt-1 grid gap-1 pl-4">{latestRunDetail.actions.map((action) => <li key={action.id}>{action.summary} · {action.state}</li>)}</ul></div> : null}<div><strong className="text-[var(--misty-text-muted)]">Output</strong><pre className="mb-0 mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-2">{JSON.stringify(latestRunDetail.run.outputs, null, 2)}</pre></div></div> : null}</section> : null}{pendingRun ? <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3"><p className="m-0 text-xs text-amber-100">This capability needs your approval.</p><p className="mb-3 mt-1 text-[10px] text-amber-200/70">{pendingRun.workflow_identifier}@{pendingRun.workflow_version}</p><div className="flex gap-2"><button className={secondaryButton} disabled={busy} type="button" onClick={() => void decide(false)}><X size={13}/>Reject</button><button className={primaryButton} disabled={busy} type="button" onClick={() => void decide(true)}><Check size={13}/>Approve</button></div></div> : null}{error ? <p className="mb-2 mt-0 text-[11px] text-red-300" role="alert">{error}</p> : null}<form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}><input className="min-h-10 flex-1 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs outline-none" data-dialog-autofocus value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={`Ask ${agent.name}…`} aria-label={`Message ${agent.name}`}/><button className={primaryButton} disabled={busy || !prompt.trim()} type="submit"><Send size={14}/>{busy ? "Working…" : "Send"}</button></form></footer>
  </section>;
  return embedded ? panel : <div className="fixed inset-0 z-50 flex justify-end bg-black/55" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>{panel}</div>;
}

async function loadConversationState(
  id: string,
  active: () => boolean,
  setEvents: (items: AgentConversationEvent[]) => void,
  setLatestRunDetail: (detail: { run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] } | null) => void,
  setPendingRun: (run: SpaceRun | null) => void,
  setError: (value: string) => void,
): Promise<AgentConversationEvent[]> {
  try {
    const result = await agentArchitectureApi.conversationEvents(id);
    if (!active()) return result.events;
    setEvents(result.events);
    const runEvent = [...result.events].reverse().find((event) => event.event_type === "run" && typeof event.data.run_id === "string");
    if (!runEvent || typeof runEvent.data.run_id !== "string") {
      setLatestRunDetail(null);
      setPendingRun(null);
      return result.events;
    }
    const detail = await agentArchitectureApi.runDetail(runEvent.data.run_id);
    if (active()) {
      setLatestRunDetail(detail);
      setPendingRun(detail.run.state === "awaiting_approval" ? detail.run : null);
    }
    return result.events;
  } catch (reason) {
    if (active()) setError(errorText(reason));
    return [];
  }
}
function eventText(event: AgentConversationEvent) { return typeof event.data.text === "string" && event.data.text.trim() ? event.data.text : event.event_type === "error" ? "The agent run failed." : "Agent run updated."; }
const iconButton = "grid size-8 place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)]";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)] disabled:opacity-50";
const secondaryButton = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-[11px] disabled:opacity-50";
