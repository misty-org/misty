import { useAuth } from "@/features/auth";
import { Button, Textarea, cn } from "@/shared/ui";
import { BookmarkPlus, CircleAlert, Loader2, Send, Sparkles, Square, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useAiSurfaceStore } from "./store";
import { aiSurfaceApi } from "./api";
import type { AiSavedAction, AiSurfacePreferenceRecord } from "./api";
import type { AiRecapRecord } from "./api";
import { AiContextBar, AiDrawerWelcome } from "./AiDrawerParts";
import { AiMessage, handoffPromptFor } from "./AiMessage";
import {
  AiProactiveNudge,
  AiRecapCard,
  AiRecapNudge,
  isRecapSurface,
  isUnseenRecap,
} from "./AiRecap";
import type { AiSurfaceAdapter, AiSuggestedAction } from "./types";
import "./aiSurface.css";

export type {
  AiArtifact,
  AiContextReference,
  AiSelectionSnapshot,
  AiSuggestedAction,
  AiSurfaceAdapter,
  AiSurfaceId,
} from "./types";

interface AiPaneContextValue {
  paneId: string;
  accountId: string;
  adapter: AiSurfaceAdapter | null;
  register: (adapter: AiSurfaceAdapter) => () => void;
  open: () => void;
}

const AiPaneContext = createContext<AiPaneContextValue | null>(null);

export function AiPaneHost({
  paneId,
  children,
  defaultAdapter = null,
}: {
  paneId: string;
  children: ReactNode;
  defaultAdapter?: AiSurfaceAdapter | null;
}) {
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const [registeredAdapter, setRegisteredAdapter] = useState<AiSurfaceAdapter | null>(null);
  const [preference, setPreference] = useState<AiSurfacePreferenceRecord | null>(null);
  const [recap, setRecap] = useState<AiRecapRecord | null>(null);
  const [proactiveDismissed, setProactiveDismissed] = useState(false);
  const adapterRef = useRef<AiSurfaceAdapter | null>(null);
  const adapter = registeredAdapter ?? defaultAdapter;
  const open = useAiSurfaceStore(
    (state) => state.sessions[`${accountId}:${paneId}`]?.open ?? false,
  );
  const setOpen = useAiSurfaceStore((state) => state.setOpen);
  const setContextBoundary = useAiSurfaceStore((state) => state.setContextBoundary);
  const register = useCallback((next: AiSurfaceAdapter) => {
    adapterRef.current = next;
    setRegisteredAdapter((current) => (current === next ? current : next));
    return () => {
      if (adapterRef.current !== next) return;
      adapterRef.current = null;
      setRegisteredAdapter(null);
    };
  }, []);
  const context = useMemo<AiPaneContextValue>(
    () => ({
      paneId,
      accountId,
      adapter,
      register,
      open: () => accountId && setOpen(accountId, paneId, true),
    }),
    [accountId, adapter, paneId, register, setOpen],
  );

  const boundary = aiContextBoundary(adapter);
  useEffect(() => {
    if (accountId && adapter) setContextBoundary(accountId, paneId, boundary);
  }, [accountId, adapter, boundary, paneId, setContextBoundary]);

  const surfaceId = adapter?.surfaceId;
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!accountId || !surfaceId) {
        setPreference(null);
        setRecap(null);
        return;
      }
      void Promise.all([
        aiSurfaceApi.settings(),
        isRecapSurface(surfaceId)
          ? aiSurfaceApi.recaps()
          : Promise.resolve({ recaps: [] as AiRecapRecord[] }),
      ])
        .then(([result, recapResult]) => {
          if (!active) return;
          const saved = result.preferences.find((item) => item.surface_id === surfaceId);
          setPreference(
            result.settings.enabled
              ? (saved ?? {
                  surface_id: surfaceId,
                  proactive_enabled: false,
                  saved_actions: [],
                })
              : null,
          );
          useAiSurfaceStore.getState().setPinnedAgent(accountId, surfaceId, saved?.pinned_agent_id);
          setRecap(recapResult.recaps.find((item) => item.surface_id === surfaceId) ?? null);
        })
        .catch(() => {
          if (!active) return;
          setPreference(null);
          setRecap(null);
        });
    };
    setProactiveDismissed(false);
    refresh();
    window.addEventListener("misty:ai-preferences-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("misty:ai-preferences-changed", refresh);
    };
  }, [accountId, surfaceId]);
  useEffect(() => {
    if (!open || !recap || !isUnseenRecap(recap)) return;
    const seenAt = new Date().toISOString();
    setRecap((current) => (current ? { ...current, last_seen_at: seenAt } : current));
    void aiSurfaceApi.markRecapSeen(recap.surface_id).catch(() => undefined);
  }, [open, recap]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("misty:ai-drawer-visibility", {
        detail: { paneId, open: Boolean(open && adapter) },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("misty:ai-drawer-visibility", { detail: { paneId, open: false } }),
      );
    };
  }, [adapter, open, paneId]);

  return (
    <AiPaneContext.Provider value={context}>
      <div className={cn("misty-ai-pane-host", open && adapter && "is-ai-open")}>
        <div className="misty-ai-pane-content">{children}</div>
        {defaultAdapter && !registeredAdapter ? (
          <div className="misty-ai-default-launcher">
            <AiSurfaceButton />
          </div>
        ) : null}
        {recap && isUnseenRecap(recap) && !proactiveDismissed && !open && adapter ? (
          <AiRecapNudge
            recap={recap}
            onDismiss={() => setProactiveDismissed(true)}
            onOpen={() => {
              if (accountId) setOpen(accountId, paneId, true);
            }}
          />
        ) : preference?.proactive_enabled && !proactiveDismissed && !open && adapter ? (
          <AiProactiveNudge
            accountId={accountId}
            paneId={paneId}
            adapter={adapter}
            onDismiss={() => setProactiveDismissed(true)}
            onOpen={() => accountId && setOpen(accountId, paneId, true)}
          />
        ) : null}
        {open && adapter && accountId ? (
          <AiDrawer
            accountId={accountId}
            paneId={paneId}
            adapter={adapter}
            preference={preference}
            recap={recap}
            onPreferenceChange={setPreference}
          />
        ) : null}
      </div>
    </AiPaneContext.Provider>
  );
}

function aiContextBoundary(adapter: AiSurfaceAdapter | null) {
  if (!adapter) return "none";
  const context = adapter.getContext();
  const spaces = [
    ...new Set(
      context
        .filter((item) => item.privacy === "shared")
        .map((item) => item.spaceId)
        .filter(Boolean),
    ),
  ];
  if (spaces.length) return `shared:${spaces.sort().join(",")}`;
  return context.some((item) => item.privacy === "device" || item.privacy === "private")
    ? "private"
    : context.some((item) => item.privacy === "provider")
      ? "provider"
      : `surface:${adapter.surfaceId}`;
}

export function useAiSurfaceAdapter(adapter: AiSurfaceAdapter | null) {
  const context = useContext(AiPaneContext);
  const register = context?.register;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const surfaceId = adapter?.surfaceId;
  const label = adapter?.label;

  useEffect(() => {
    if (!register || !adapterRef.current) return;
    return register(adapterRef.current);
  }, [surfaceId, label, register]);
}

/** Lets inline affordances join the pane's existing Misty conversation. */
export function useAiSurfaceActions(adapter?: AiSurfaceAdapter | null) {
  const context = useContext(AiPaneContext);
  const submit = useAiSurfaceStore((state) => state.submit);
  return useMemo(
    () => ({
      available: Boolean(context && (adapter || context.adapter)),
      open: () => context?.open(),
      runAction: (action: AiSuggestedAction) => {
        const active = adapter ?? context?.adapter;
        if (!context || !active || !context.accountId) return Promise.resolve();
        context.open();
        return submit(context.accountId, context.paneId, active, action);
      },
    }),
    [adapter, context, submit],
  );
}

export function AiSurfaceButton({ className }: { className?: string }) {
  const context = useContext(AiPaneContext);
  if (!context?.adapter) return null;
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn("size-8", className)}
      aria-label={`Ask Misty about ${context.adapter.label}`}
      title={`Ask Misty about ${context.adapter.label}`}
      onClick={context.open}
    >
      <Sparkles className="size-4" />
    </Button>
  );
}

function AiDrawer({
  accountId,
  paneId,
  adapter,
  preference,
  recap,
  onPreferenceChange,
}: {
  accountId: string;
  paneId: string;
  adapter: AiSurfaceAdapter;
  preference: AiSurfacePreferenceRecord | null;
  recap: AiRecapRecord | null;
  onPreferenceChange: (preference: AiSurfacePreferenceRecord) => void;
}) {
  const { session, setOpen, setPrompt, submit, cancel, decideArtifact } = useAiSurfaceStore(
    useShallow((state) => ({
      session: state.sessions[`${accountId}:${paneId}`],
      setOpen: state.setOpen,
      setPrompt: state.setPrompt,
      submit: state.submit,
      cancel: state.cancel,
      decideArtifact: state.decideArtifact,
    })),
  );
  const current = session ?? {
    accountId,
    paneId,
    open: true,
    prompt: "",
    state: "idle" as const,
    messages: [],
  };
  const context = adapter.getContext();
  const savedActions: AiSuggestedAction[] = (preference?.saved_actions ?? []).map((action) => ({
    id: `saved:${action.id}`,
    label: action.label,
    prompt: action.prompt,
    requestedArtifactKind: action.requested_artifact_kind,
  }));
  const actions = [...savedActions, ...(adapter.getSuggestedActions?.() ?? [])];
  const working = current.state === "queued" || current.state === "running";
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [current.messages, current.state]);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    void submit(accountId, paneId, adapter);
  };
  const saveCurrentAction = async () => {
    const prompt = current.prompt.trim();
    if (!prompt || !preference || preference.saved_actions.length >= 20) return;
    const action: AiSavedAction = {
      id: crypto.randomUUID(),
      label: prompt.length > 48 ? `${prompt.slice(0, 47)}…` : prompt,
      prompt,
    };
    const result = await aiSurfaceApi.updatePreference(adapter.surfaceId, {
      pinned_agent_id: preference.pinned_agent_id,
      proactive_enabled: preference.proactive_enabled,
      saved_actions: [...preference.saved_actions, action],
    });
    onPreferenceChange(result.preference);
    window.dispatchEvent(new Event("misty:ai-preferences-changed"));
  };

  return (
    <aside className="misty-ai-drawer" aria-label={`Misty for ${adapter.label}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-charcoal-border px-3">
        <span className="grid size-7 place-items-center rounded-md bg-charcoal-active text-cream-bright">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-sm font-semibold">Misty</h2>
          <p className="m-0 truncate text-[10px] text-cream-muted">Using {adapter.label}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Close Misty"
          onClick={() => setOpen(accountId, paneId, false)}
        >
          <X className="size-4" />
        </Button>
      </header>

      <AiContextBar context={context} />

      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {recap?.last_result ? <AiRecapCard recap={recap} /> : null}
        {!current.messages.length ? (
          <AiDrawerWelcome
            label={adapter.label}
            actions={actions}
            onAction={(action) => void submit(accountId, paneId, adapter, action)}
          />
        ) : (
          <div className="space-y-4">
            {current.messages.map((item, index) => (
              <AiMessage
                key={item.id}
                message={item}
                adapter={adapter}
                accountId={accountId}
                paneId={paneId}
                handoffPrompt={handoffPromptFor(current.messages, index)}
                onDecision={(artifact, decision) =>
                  void decideArtifact(accountId, paneId, adapter, artifact, decision)
                }
              />
            ))}
            {working ? (
              <div className="flex items-center gap-2 text-xs text-cream-muted" role="status">
                <Loader2 className="size-3.5 animate-spin" /> Misty is working…
              </div>
            ) : null}
            {current.error ? (
              <div
                className="flex gap-2 rounded-lg border border-notification-red/25 bg-notification-red/10 p-3 text-xs"
                role="alert"
              >
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{current.error}</span>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form className="shrink-0 border-t border-charcoal-border p-3" onSubmit={send}>
        <div className="rounded-xl border border-charcoal-border bg-charcoal-card p-2 focus-within:border-cream-muted/40">
          <Textarea
            value={current.prompt}
            rows={2}
            className="max-h-32 min-h-14 resize-none border-0 bg-transparent p-1.5 shadow-none focus-visible:ring-0"
            placeholder={`Ask Misty about ${adapter.label}`}
            aria-label={`Ask Misty about ${adapter.label}`}
            onChange={(event) => setPrompt(accountId, paneId, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-[10px]"
              disabled={
                !current.prompt.trim() || !preference || preference.saved_actions.length >= 20
              }
              onClick={() => void saveCurrentAction()}
            >
              <BookmarkPlus className="size-3.5" /> Save action
            </Button>
            {working ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 rounded-full"
                aria-label="Stop Misty"
                onClick={() => void cancel(accountId, paneId)}
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="size-8 rounded-full"
                disabled={!current.prompt.trim()}
                aria-label="Send to Misty"
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
