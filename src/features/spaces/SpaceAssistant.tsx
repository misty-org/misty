import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { AssistantComposerActions } from "@/features/explorer/desktop/ExplorerAssistantComposer";
import { AssistantMessage } from "@/features/explorer/desktop/ExplorerAssistantMessage";
import { useMikaPeekAnimation } from "@/features/explorer/desktop/ExplorerAssistantShared";
import { assistantPanelStyles } from "@/features/explorer/desktop/ExplorerAssistantStyles";
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "@/platform/runtimeAsset";
import { selectAssistantPreferences, useAppStore, useSettingsStore } from "@/stores/app";
import {
  assistantDailyMessageLimit,
  useAssistantUsageStore,
} from "@/stores/assistant/useAssistantUsageStore";
import { spaceMikaScopeKey, useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";
import { Badge, Progress, Textarea } from "@/ui";
import { buildSpaceMikaContext, spaceAssistantPrompt } from "./mika/spaceMikaContext";

export function SpaceAssistant({
  accountId,
  spaceId,
  spaceName,
  permissions,
}: {
  accountId: string;
  spaceId: string;
  spaceName: string;
  permissions?: Record<string, boolean>;
}) {
  const scopeKey = useMemo(() => spaceMikaScopeKey(accountId, spaceId), [accountId, spaceId]);
  const {
    status,
    mode,
    messages,
    plans,
    toolApprovals,
    error,
    conversationScopeKey,
    refreshStatus,
    activateConversationScope,
    setMode,
    sendPrompt,
    abortPrompt,
    approvePlan,
    approveToolRequest,
  } = useMikaSessionStore(
    useShallow((state) => ({
      status: state.status,
      mode: state.mode,
      messages: state.messages,
      plans: state.plans,
      toolApprovals: state.toolApprovals,
      error: state.error,
      conversationScopeKey: state.conversationScopeKey,
      refreshStatus: state.refreshStatus,
      activateConversationScope: state.activateConversationScope,
      setMode: state.setMode,
      sendPrompt: state.sendPrompt,
      abortPrompt: state.abortPrompt,
      approvePlan: state.approvePlan,
      approveToolRequest: state.approveToolRequest,
    })),
  );
  const { messagesUsedToday, syncForToday } = useAssistantUsageStore(
    useShallow((state) => ({
      messagesUsedToday: state.messagesUsedToday,
      syncForToday: state.syncForToday,
    })),
  );
  const mikaEnabled = useSettingsStore(
    (state) => selectAssistantPreferences(state.settings?.document).enabled,
  );
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const [prompt, setPrompt] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [contextNotice, setContextNotice] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const requestGeneration = useRef(0);
  const scopeReady = conversationScopeKey === scopeKey;
  const running = scopeReady && (status?.running ?? false);
  const configured = status?.configured ?? false;
  const supportsPrivateSpaceSessions = status?.spaceScopedSessions ?? false;
  const available = configured && mikaEnabled && supportsPrivateSpaceSessions;
  const mikaAnimationSource = runtimeAssetSource(assetsDir, "animations/mika.webp");
  const mikaPeek = useMikaPeekAnimation(true);

  useEffect(() => {
    requestGeneration.current += 1;
    setPrompt("");
    setContextNotice("");
    let active = true;
    void activateConversationScope(scopeKey).then(() => {
      if (active && useMikaSessionStore.getState().conversationScopeKey === scopeKey) {
        void refreshStatus();
      }
    });
    return () => {
      active = false;
      requestGeneration.current += 1;
    };
  }, [activateConversationScope, refreshStatus, scopeKey]);

  useEffect(() => {
    syncForToday();
    const interval = window.setInterval(syncForToday, 60_000);
    return () => window.clearInterval(interval);
  }, [syncForToday]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (scopeReady && available) promptRef.current?.focus();
  }, [available, scopeReady]);

  const submitPrompt = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || running || preparing || !scopeReady || !available) return;
    const generation = ++requestGeneration.current;
    setPreparing(true);
    setContextNotice("");
    try {
      const result = await buildSpaceMikaContext({
        spaceId,
        spaceName,
        question: trimmed,
        permissions,
      });
      if (
        generation !== requestGeneration.current ||
        useMikaSessionStore.getState().conversationScopeKey !== scopeKey
      ) {
        return;
      }
      setPrompt("");
      if (result.unavailableSections.length > 0) {
        setContextNotice(
          `${[...new Set(result.unavailableSections)].join(", ")} context is temporarily unavailable.`,
        );
      }
      await sendPrompt({
        displayPrompt: trimmed,
        prompt: spaceAssistantPrompt(trimmed, spaceName, result.context),
        cwd: null,
        selectedPaths: [],
        contextSources: result.sources,
      });
    } catch (reason) {
      if (generation === requestGeneration.current) {
        setContextNotice(
          reason instanceof Error ? reason.message : "Mika could not prepare Space context.",
        );
      }
    } finally {
      if (generation === requestGeneration.current) setPreparing(false);
    }
  }, [
    available,
    permissions,
    preparing,
    prompt,
    running,
    scopeKey,
    scopeReady,
    sendPrompt,
    spaceId,
    spaceName,
  ]);

  const emptyState = spaceAssistantEmptyState({
    available,
    configured,
    mikaEnabled,
    scopeReady,
    spaceName,
  });

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-6">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Bot className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h1 className="min-w-0 truncate text-lg font-semibold text-foreground">Assistant</h1>
          {running ? (
            <Badge variant="secondary" className="shrink-0">
              Running
            </Badge>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline" className="max-w-64 truncate">
            Private · {spaceName}
          </Badge>
          <div className="grid min-w-[140px] gap-1">
            <span className="text-right text-[11px] tabular-nums text-muted-foreground">
              {messagesUsedToday} / {assistantDailyMessageLimit} today
            </span>
            <Progress
              aria-label="Mika daily message usage"
              className="h-1.5 w-[140px]"
              value={Math.min(100, (messagesUsedToday / assistantDailyMessageLimit) * 100)}
            />
          </div>
        </div>
      </header>

      {(scopeReady && error) || contextNotice ? (
        <p className={assistantPanelStyles.errorText} role="status">
          {(scopeReady && error) || contextNotice}
        </p>
      ) : null}

      <div
        ref={logRef}
        className={`${assistantPanelStyles.log} gap-2.5`}
        aria-live="polite"
        aria-busy={preparing || running}
      >
        {!scopeReady || messages.length === 0 ? (
          <SpaceAssistantEmptyState title={emptyState.title} detail={emptyState.detail} />
        ) : (
          messages.map((message) => (
            <AssistantMessage
              key={message.id}
              message={message}
              running={running}
              plans={plans}
              toolApprovals={toolApprovals}
              onApplyPlan={approvePlan}
              onApproveTool={approveToolRequest}
            />
          ))
        )}
      </div>

      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          void submitPrompt();
        }}
      >
        {mikaAnimationSource ? (
          <img
            alt=""
            aria-hidden="true"
            className={[
              "pointer-events-none absolute -top-14 z-0 h-20 w-24 select-none object-contain",
              "drop-shadow-md transition-[opacity,transform] duration-500 ease-out",
              "motion-reduce:transition-none",
              mikaPeek.popped ? "opacity-100" : "opacity-0",
            ].join(" ")}
            draggable={false}
            src={mikaAnimationSource}
            onError={hideRuntimeAssetOnError}
            onLoad={revealRuntimeAssetOnLoad}
            style={{
              left: `${mikaPeek.leftPercent}%`,
              transform: mikaPeek.popped
                ? `translateX(-50%) translateY(0) scale(1) rotate(${mikaPeek.tiltDegrees}deg)`
                : `translateX(-50%) translateY(48px) scale(0.82) rotate(${mikaPeek.tiltDegrees}deg)`,
            }}
          />
        ) : null}
        <div className="relative z-10 min-w-0 rounded-xl bg-muted/60">
          <Textarea
            ref={promptRef}
            aria-label={`Ask Mika about ${spaceName}`}
            className={[
              "max-h-[260px] min-h-[72px] w-full resize-none rounded-none border-0",
              "bg-transparent px-4 pb-2 pt-3.5 text-sm shadow-none focus-visible:ring-0",
            ].join(" ")}
            value={prompt}
            rows={3}
            placeholder={spaceAssistantPlaceholder({
              available,
              configured,
              mikaEnabled,
              scopeReady,
              spaceName,
            })}
            disabled={!available || running || preparing || !scopeReady}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submitPrompt();
              }
            }}
          />
          <AssistantComposerActions
            mode={mode}
            modelName={scopeReady ? (status?.modelName ?? "Mika") : "Mika"}
            configured={available && scopeReady && !preparing}
            running={running}
            prompt={prompt}
            setMode={setMode}
            abortPrompt={abortPrompt}
            showAccessControls={false}
            contextLabel={preparing ? "Selecting authorized context…" : "Space context only"}
          />
        </div>
      </form>
    </div>
  );
}

function SpaceAssistantEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid min-h-72 place-items-center px-4 py-10 text-center">
      <div className="grid max-w-md justify-items-center gap-3">
        <span className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Bot size={22} />
        </span>
        <h2 className="m-0 text-base font-semibold text-foreground">{title}</h2>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function spaceAssistantEmptyState(input: {
  available: boolean;
  configured: boolean;
  mikaEnabled: boolean;
  scopeReady: boolean;
  spaceName: string;
}) {
  if (!input.scopeReady) {
    return {
      title: "Switching Space context…",
      detail: "Preparing a private Assistant session for this Space.",
    };
  }
  if (input.available) {
    return {
      title: `Ask Mika about ${input.spaceName}`,
      detail:
        "Mika can use the Space content you are allowed to access. This conversation is visible only to you.",
    };
  }
  if (!input.mikaEnabled) {
    return {
      title: "Mika is disabled",
      detail: "Enable Mika in Settings to use private Space conversations.",
    };
  }
  if (!input.configured) {
    return {
      title: "Mika is unavailable",
      detail: "Mika is temporarily unavailable. Try again after the service reconnects.",
    };
  }
  return {
    title: "Private Space Assistant is unavailable",
    detail:
      "This Misty server does not yet support permission-checked Space sessions. Files Mika remains available.",
  };
}

function spaceAssistantPlaceholder(input: {
  available: boolean;
  configured: boolean;
  mikaEnabled: boolean;
  scopeReady: boolean;
  spaceName: string;
}): string {
  if (!input.scopeReady) return "Switching Space context…";
  if (input.available) return `Ask Mika about ${input.spaceName}…`;
  if (!input.mikaEnabled) return "Mika is disabled";
  if (!input.configured) return "Mika is unavailable";
  return "Private Space sessions are unavailable";
}
