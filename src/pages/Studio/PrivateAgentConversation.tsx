import { useEffect, useState } from "react";
import { Check, LockKeyhole, Send, X } from "lucide-react";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import type { PrivateAgentConversation, PrivateConversationEvent, SpaceRun, SpaceStudioResource } from "../../spaces/types";
import { errorText } from "../../shared/format";

export function PrivateAgentConversationPanel({ agent, onClose }: { agent: SpaceStudioResource; onClose: () => void }) {
  const [conversation, setConversation] = useState<PrivateAgentConversation | null>(null);
  const [events, setEvents] = useState<PrivateConversationEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [pendingRun, setPendingRun] = useState<SpaceRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void agentArchitectureApi.conversations().then(({ conversations }) => {
      if (!active) return;
      const existing = conversations.find((item) => item.agent_id === agent.id && item.space_id === agent.space_id) ?? null;
      setConversation(existing);
      if (existing) void loadEvents(existing.id, active, setEvents, setError);
    }).catch((reason) => active && setError(errorText(reason)));
    return () => { active = false; };
  }, [agent.id, agent.space_id]);

  const ensureConversation = async () => {
    if (conversation) return conversation;
    const created = await agentArchitectureApi.createConversation(agent.space_id, agent.id, `Private with ${agent.name}`);
    setConversation(created);
    return created;
  };
  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true); setError(""); setPrompt("");
    try {
      const target = await ensureConversation();
      const response = await agentArchitectureApi.sendConversationMessage(target.id, { prompt: text, input: { prompt: text } });
      setPendingRun(response.run?.state === "awaiting_approval" ? response.run : null);
      await loadEvents(target.id, true, setEvents, setError);
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const decide = async (approved: boolean) => {
    if (!pendingRun) return;
    setBusy(true);
    try { await agentArchitectureApi.decideRun(pendingRun.id, approved); setPendingRun(null); if (conversation) await loadEvents(conversation.id, true, setEvents, setError); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/55" role="dialog" aria-modal="true" aria-label={`Private conversation with ${agent.name}`}><section className="grid h-full w-full max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] border-l border-[var(--misty-border-soft)] bg-[var(--misty-surface)] shadow-2xl">
    <header className="flex items-start justify-between border-b border-[var(--misty-border-soft)] p-4"><div><span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-sky-200"><LockKeyhole size={11}/>Private to you</span><h2 className="mb-0 mt-2 text-base">{agent.name}</h2><p className="m-0 mt-1 text-[11px] text-[var(--misty-text-subtle)]">This conversation never appears in shared Space chat.</p></div><button className={iconButton} type="button" onClick={onClose} aria-label="Close private conversation"><X size={15}/></button></header>
    <div className="min-h-0 overflow-auto p-4">{events.length === 0 ? <div className="grid h-full place-items-center text-center"><div><LockKeyhole className="mx-auto text-sky-300"/><p className="mb-1 mt-3 text-sm">Start a private conversation</p><p className="m-0 max-w-xs text-[11px] leading-relaxed text-[var(--misty-text-subtle)]">Only you can open this thread. Every request still creates an isolated, auditable run.</p></div></div> : <div className="grid gap-2">{events.filter((event) => event.event_type.endsWith("message") || event.event_type === "error").map((event) => <article className={`rounded-xl p-3 text-xs leading-relaxed ${event.event_type === "user_message" ? "ml-10 bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)]" : "mr-10 bg-[var(--misty-surface-2)]"}`} key={event.id}>{eventText(event)}</article>)}</div>}</div>
    <footer className="border-t border-[var(--misty-border-soft)] p-4">{pendingRun ? <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3"><p className="m-0 text-xs text-amber-100">This capability needs your approval.</p><p className="mb-3 mt-1 text-[10px] text-amber-200/70">{pendingRun.workflow_identifier}@{pendingRun.workflow_version}</p><div className="flex gap-2"><button className={secondaryButton} disabled={busy} type="button" onClick={() => void decide(false)}><X size={13}/>Reject</button><button className={primaryButton} disabled={busy} type="button" onClick={() => void decide(true)}><Check size={13}/>Approve</button></div></div> : null}{error ? <p className="mb-2 mt-0 text-[11px] text-red-300">{error}</p> : null}<form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}><input className="min-h-10 flex-1 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs outline-none" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={`Ask ${agent.name} privately…`}/><button className={primaryButton} disabled={busy || !prompt.trim()} type="submit"><Send size={14}/>{busy ? "Working…" : "Send"}</button></form></footer>
  </section></div>;
}

async function loadEvents(id: string, active: boolean, setEvents: (items: PrivateConversationEvent[]) => void, setError: (value: string) => void) { try { const result = await agentArchitectureApi.conversationEvents(id); if (active) setEvents(result.events); } catch (reason) { if (active) setError(errorText(reason)); } }
function eventText(event: PrivateConversationEvent) { return typeof event.data.text === "string" && event.data.text.trim() ? event.data.text : event.event_type === "error" ? "The agent run failed." : "Agent run updated."; }
const iconButton = "grid size-8 place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)]";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)] disabled:opacity-50";
const secondaryButton = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-[11px] disabled:opacity-50";
