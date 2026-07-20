import { ArrowUp, ChevronDown, Info, Mic, Plus, ShieldAlert, Sparkles, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "@/shared/assets/runtimeAsset";
import { useMultiPanelStore } from "@/shared/multipanel/useMultiPanelStore";
import { useAppStore } from "../../../stores/useAppStore";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { useMikaSessionStore } from "../../../stores/useMikaSessionStore";
import type { AiMode } from "../../../stores/aiServerApi";
import { AssistantMessage } from "./ExplorerAssistantMessage";
import { MikaContextContent, MikaEmptyState } from "./ExplorerAssistantContext";
import {
  assistantPlaceholder,
  buildMikaPrompt,
  randomInteger,
  randomMikaPeek,
  selectedPathsAcrossPanes,
} from "./ExplorerAssistantShared";
import { assistantPanelStyles } from "./ExplorerAssistantStyles";
import { cx } from "./ExplorerDesktopShared";

export interface ExplorerMikaPanelProps {
  surface?: "explorer" | "bot" | "bot-window" | "bot-chat-window";
  onHeaderDragStart?: () => void;
  onClose?: () => void;
  workingDirectory?: string;
  selectedPaths?: string[];
}

export const ExplorerMikaPanel = memo(function ExplorerMikaPanel(props: ExplorerMikaPanelProps) {
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const mikaAnimationSource = runtimeAssetSource(assetsDir, "animations/mika.webp");
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const panes = useExplorerStore((state) => state.panes);
  const listing = useExplorerStore((state) => state.panes[activePaneId]?.listing ?? null);
  const explorerSelectedPaths = useMemo(() => selectedPathsAcrossPanes(panes), [panes]);
  const selectedPaths = props.selectedPaths ?? explorerSelectedPaths;
  const {
    status,
    mode,
    messages,
    plans,
    toolApprovals,
    error,
    refreshStatus,
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
      setMode: state.setMode,
      sendPrompt: state.sendPrompt,
      abortPrompt: state.abortPrompt,
      approvePlan: state.approvePlan,
      approveToolRequest: state.approveToolRequest,
    })),
  );
  const [prompt, setPrompt] = useState("");
  const [mikaPeek, setMikaPeek] = useState(() => randomMikaPeek());
  const logRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const workingDirectory = props.workingDirectory ?? listing?.path ?? "";
  const running = status?.running ?? false;
  const configured = status?.configured ?? false;
  const chatWindow = props.surface === "bot-chat-window";

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!chatWindow) return;
    let timer = 0;
    let disposed = false;
    const scheduleRetreat = () => {
      timer = window.setTimeout(
        () => {
          setMikaPeek((peek) => ({ ...peek, popped: false }));
          timer = window.setTimeout(
            () => {
              if (disposed) return;
              setMikaPeek(randomMikaPeek());
              scheduleRetreat();
            },
            randomInteger(700, 1_500),
          );
        },
        randomInteger(3_500, 7_500),
      );
    };
    scheduleRetreat();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [chatWindow]);

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
    <aside className={mikaPanelClass(props.surface)} aria-label="Mika Assistant">
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
          Mika{" "}
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
                aria-label="Mika context"
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
            aria-label="Close Mika"
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
              placeholder={assistantPlaceholder(configured, "Ask Mika to organize this folder...")}
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
              <ChatWindowComposerActions
                mode={mode}
                modelName={status?.modelName ?? "Mika"}
                configured={configured}
                running={running}
                prompt={prompt}
                setMode={setMode}
                abortPrompt={abortPrompt}
              />
            ) : (
              <div
                className={`${assistantPanelStyles.composerActions} ${assistantPanelStyles.mikaComposerActions}`}
              >
                <Select
                  value={mode === "full" ? "auto" : mode}
                  onValueChange={(value) => setMode(value as Parameters<typeof setMode>[0])}
                >
                  <SelectTrigger className="h-9 w-32" aria-label="Mika mode">
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
                    title="Cancel the active Mika gateway request."
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
            Mika can make mistakes. Review file plans before applying them.
          </footer>
        )}
      </div>
    </aside>
  );
});

function ChatWindowComposerActions(props: {
  mode: AiMode;
  modelName: string;
  configured: boolean;
  running: boolean;
  prompt: string;
  setMode: (mode: AiMode) => void;
  abortPrompt: () => Promise<void>;
}) {
  return (
    <div className="relative z-10 flex h-[50px] min-w-0 items-center justify-between gap-3 px-3 pb-2">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          disabled
          title="Attachments coming soon"
          type="button"
          aria-label="Add context"
        >
          <Plus size={19} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cx(
                "h-9 min-w-[124px] justify-start gap-2 px-2.5",
                props.mode !== "ask" && "text-destructive",
              )}
              type="button"
            >
              <ShieldAlert size={17} />
              <span className="min-w-0 flex-1 truncate text-left">
                {props.mode === "ask" ? "Ask first" : "Full access"}
              </span>
              <ChevronDown size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-40">
            <DropdownMenuRadioGroup
              value={props.mode === "ask" ? "ask" : "auto"}
              onValueChange={(value) => props.setMode(value === "auto" ? "auto" : "ask")}
            >
              <DropdownMenuRadioItem value="ask">Ask first</DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="auto"
                className="text-destructive focus:text-destructive"
              >
                Full access
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span
          className="max-w-28 truncate px-1 text-sm text-muted-foreground"
          title={props.modelName}
        >
          {props.modelName}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          disabled
          title="Voice input coming soon"
          type="button"
          aria-label="Voice input"
        >
          <Mic size={17} />
        </Button>
        {props.running ? (
          <Button
            size="icon"
            className="size-9 rounded-full"
            type="button"
            aria-label="Stop Mika"
            title="Cancel the active Mika request"
            onClick={props.abortPrompt}
          >
            <X size={17} />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-9 rounded-full"
            type="submit"
            aria-label="Send to Mika"
            disabled={!props.configured || !props.prompt.trim()}
          >
            <ArrowUp size={19} />
          </Button>
        )}
      </div>
    </div>
  );
}

function mikaPanelClass(surface: ExplorerMikaPanelProps["surface"]): string {
  if (surface === "bot-chat-window") return assistantPanelStyles.mikaChatWindowPanel;
  if (surface === "bot-window") return assistantPanelStyles.mikaBotWindowPanel;
  if (surface === "bot") return assistantPanelStyles.mikaBotPanel;
  return assistantPanelStyles.mikaPanel;
}
