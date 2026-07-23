import type { ExplorerMikaPanelProps } from "@/models/interfaces/features/explorer/desktop/ExplorerMikaPanel";
export type { ExplorerMikaPanelProps } from "@/models/interfaces/features/explorer/desktop/ExplorerMikaPanel";
import { ArrowUp, Info, Sparkles, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Textarea } from "@/ui";
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "@/platform/runtimeAsset";
import { useMultiPanelStore } from "@/features/workspace";
import { useAppStore } from "@/stores/app";
import { useExplorerStore } from "@/stores/explorer";
import { filesMikaScopeKey, useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";
import { MistyPicker } from "@/features/picker/MistyPicker";
import { AssistantMessage } from "./ExplorerAssistantMessage";
import { MikaContextContent, MikaEmptyState } from "./ExplorerAssistantContext";
import { AssistantComposerActions } from "./ExplorerAssistantComposer";
import {
  assistantPlaceholder,
  buildMikaPrompt,
  selectedPathsAcrossPanes,
  useMikaPeekAnimation,
} from "./ExplorerAssistantShared";
import { assistantPanelStyles } from "./ExplorerAssistantStyles";
import { cx } from "./ExplorerDesktopShared";
import { initialAgentModelName } from "@/features/agents/modelSelection";

export const ExplorerMikaPanel = memo(function ExplorerMikaPanel(props: ExplorerMikaPanelProps) {
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const mikaAnimationSource = runtimeAssetSource(assetsDir, "animations/mika.webp");
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const panes = useExplorerStore((state) => state.panes);
  const listing = useExplorerStore((state) => state.panes[activePaneId]?.listing ?? null);
  const explorerSelectedPaths = useMemo(() => selectedPathsAcrossPanes(panes), [panes]);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [manualContextPaths, setManualContextPaths] = useState<string[]>([]);
  const selectedPaths = useMemo(
    () => [...new Set([...(props.selectedPaths ?? explorerSelectedPaths), ...manualContextPaths])],
    [props.selectedPaths, explorerSelectedPaths, manualContextPaths],
  );
  const {
    status,
    mode,
    messages,
    plans,
    toolApprovals,
    error,
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
      refreshStatus: state.refreshStatus,
      activateConversationScope: state.activateConversationScope,
      setMode: state.setMode,
      sendPrompt: state.sendPrompt,
      abortPrompt: state.abortPrompt,
      approvePlan: state.approvePlan,
      approveToolRequest: state.approveToolRequest,
    })),
  );
  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const workingDirectory = props.workingDirectory ?? listing?.path ?? "";
  const running = status?.running ?? false;
  const configured = status?.configured ?? false;
  const chatWindow = props.surface === "bot-chat-window";
  const mikaPeek = useMikaPeekAnimation(chatWindow);

  useEffect(() => {
    let active = true;
    void activateConversationScope(filesMikaScopeKey).then(() => {
      if (active && useMikaSessionStore.getState().conversationScopeKey === filesMikaScopeKey)
        void refreshStatus();
    });
    return () => {
      active = false;
    };
  }, [activateConversationScope, refreshStatus]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea || !chatWindow) return;
    const maximumHeight = 200;
    const minimumHeight = 60;
    textarea.style.height = "0px";
    const contentHeight = textarea.scrollHeight;
    textarea.style.height = `${Math.min(maximumHeight, Math.max(minimumHeight, contentHeight))}px`;
    textarea.style.overflowY = contentHeight > maximumHeight ? "auto" : "hidden";
  }, [chatWindow, prompt]);

  const submitPrompt = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || running) return;
    setPrompt("");
    void sendPrompt({
      displayPrompt: trimmed,
      prompt: buildMikaPrompt(trimmed, workingDirectory, selectedPaths),
      cwd: workingDirectory || null,
      selectedPaths,
    });
  }, [prompt, running, selectedPaths, sendPrompt, workingDirectory]);

  return (
    <aside className={mikaPanelClass(props.surface)} aria-label="Agents">
      <header
        className={cx(
          assistantPanelStyles.header,
          assistantPanelStyles.mikaHeader,
          chatWindow && "cursor-grab active:cursor-grabbing [&_button]:cursor-pointer",
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement;
          if (target.closest("button, input, textarea, select, [role='button']")) return;
          props.onHeaderDragStart?.();
        }}
      >
        <span
          className={cx(assistantPanelStyles.headerTitle, assistantPanelStyles.mikaHeaderTitle)}
        >
          Agents{" "}
          {running ? <small className={assistantPanelStyles.runningBadge}>Running</small> : null}
        </span>
        <div className={assistantPanelStyles.headerActions}>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={assistantPanelStyles.headerButton}
                type="button"
                aria-label="Agent context"
              >
                <Info size={17} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(340px,calc(100vw-32px))] p-3">
              <MikaContextContent
                status={status}
                workingDirectory={workingDirectory}
                selectedPaths={selectedPaths}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className={assistantPanelStyles.headerButton}
            type="button"
            aria-label="Close Agents"
            onClick={props.onClose ?? (() => useExplorerStore.getState().setMikaPanelOpen(false))}
          >
            <X size={18} />
          </Button>
        </div>
      </header>

      <div className={assistantPanelStyles.mikaBody}>
        {error ? (
          <div className={`${assistantPanelStyles.status} ${assistantPanelStyles.mikaStatus}`}>
            <p className={assistantPanelStyles.errorText}>{error}</p>
          </div>
        ) : null}
        <div
          ref={logRef}
          className={`${assistantPanelStyles.log} ${assistantPanelStyles.mikaLog}`}
          aria-live="polite"
        >
          {messages.length === 0 ? (
            chatWindow ? null : (
              <MikaEmptyState />
            )
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
          className={cx(
            assistantPanelStyles.composer,
            assistantPanelStyles.mikaComposer,
            chatWindow && "relative z-10 border-t-0 pt-0",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          {chatWindow && mikaAnimationSource ? (
            <img
              alt=""
              aria-hidden="true"
              className={`pointer-events-none absolute -top-12 z-0 h-[72px] w-[88px] select-none object-contain drop-shadow-md transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none ${mikaPeek.popped ? "opacity-100" : "opacity-0"}`}
              draggable={false}
              src={mikaAnimationSource}
              onError={hideRuntimeAssetOnError}
              onLoad={revealRuntimeAssetOnLoad}
              style={{
                left: `${mikaPeek.leftPercent}%`,
                transform: mikaPeek.popped
                  ? `translateX(-50%) translateY(0) scale(1) rotate(${mikaPeek.tiltDegrees}deg)`
                  : `translateX(-50%) translateY(42px) scale(0.82) rotate(${mikaPeek.tiltDegrees}deg)`,
              }}
            />
          ) : null}
          <div className={chatWindow ? "relative z-10 min-w-0 rounded-xl bg-muted/60" : "contents"}>
            <Textarea
              className={cx(
                assistantPanelStyles.textarea,
                chatWindow &&
                  "w-full min-h-[60px] max-h-[200px] resize-none rounded-none border-0 bg-transparent px-4 pb-2 pt-3.5 shadow-none focus-visible:ring-0",
              )}
              ref={promptRef}
              value={prompt}
              rows={chatWindow ? 1 : 3}
              placeholder={assistantPlaceholder(
                configured,
                "Ask an agent to organize this folder...",
              )}
              disabled={!configured || running}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitPrompt();
                }
              }}
            />
            {chatWindow ? (
              <AssistantComposerActions
                mode={mode}
                modelName={status?.modelName ?? initialAgentModelName}
                configured={configured}
                running={running}
                prompt={prompt}
                setMode={setMode}
                abortPrompt={abortPrompt}
                onAddContext={() => setContextPickerOpen(true)}
              />
            ) : (
              <div
                className={`${assistantPanelStyles.composerActions} ${assistantPanelStyles.mikaComposerActions}`}
              >
                <Select
                  value={mode === "full" ? "auto" : mode}
                  onValueChange={(value) => setMode(value as Parameters<typeof setMode>[0])}
                >
                  <SelectTrigger className="h-9 w-32" aria-label="Agent mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">Ask first</SelectItem>
                    <SelectItem value="auto">Full access</SelectItem>
                  </SelectContent>
                </Select>
                {running ? (
                  <Button
                    type="button"
                    title="Cancel the active agent request."
                    onClick={abortPrompt}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" disabled={!configured || !prompt.trim()}>
                    <ArrowUp size={17} /> Send
                  </Button>
                )}
              </div>
            )}
          </div>
        </form>
        {chatWindow ? null : (
          <footer className={assistantPanelStyles.mikaFooter}>
            <Sparkles size={15} />
            Agents can make mistakes. Review file plans before applying them.
          </footer>
        )}
      </div>
      {contextPickerOpen ? (
        <MistyPicker
          multiple
          title="Add files as agent context"
          onCancel={() => setContextPickerOpen(false)}
          onChooseFiles={(paths) => {
            setManualContextPaths((current) => [...new Set([...current, ...paths])]);
            setContextPickerOpen(false);
          }}
        />
      ) : null}
    </aside>
  );
});

function mikaPanelClass(surface: ExplorerMikaPanelProps["surface"]): string {
  if (surface === "bot-chat-window") return assistantPanelStyles.mikaChatWindowPanel;
  if (surface === "bot-window") return assistantPanelStyles.mikaBotWindowPanel;
  if (surface === "bot") return assistantPanelStyles.mikaBotPanel;
  return assistantPanelStyles.mikaPanel;
}
