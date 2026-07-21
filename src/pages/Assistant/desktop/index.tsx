import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Bot, Folder } from "lucide-react";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Progress } from "@/ui";
import { Textarea } from "@/ui";
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "@/platform/runtimeAsset";
import { useMultiPanelStore } from "@/features/workspace";
import { useAppStore } from "@/stores/app";
import { useExplorerStore } from "@/stores/explorer";
import { MistyFilePicker } from "@/features/picker/FilePicker";
import { MistyPicker } from "@/features/picker/MistyPicker";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";
import {
  assistantDailyMessageLimit,
  useAssistantUsageStore,
} from "@/stores/assistant/useAssistantUsageStore";
import { AssistantMessage } from "@/features/explorer/desktop/ExplorerAssistantMessage";
import { MikaEmptyState } from "@/features/explorer/desktop/ExplorerAssistantContext";
import { AssistantComposerActions } from "@/features/explorer/desktop/ExplorerAssistantComposer";
import {
  assistantPlaceholder,
  useMikaPeekAnimation,
} from "@/features/explorer/desktop/ExplorerAssistantShared";
import { assistantPanelStyles } from "@/features/explorer/desktop/ExplorerAssistantStyles";
import { AssistantSessionSidebar } from "./AssistantSessionSidebar";
import { AssistantSessionSwitcher } from "./AssistantSessionSwitcher";

function defaultWorkingDirectory(pathParam: string | null): string {
  if (pathParam) return pathParam;
  const activePaneId = useMultiPanelStore.getState().activePaneId;
  return useExplorerStore.getState().panes[activePaneId]?.listing?.path ?? "";
}

export default function DesktopAssistantPage() {
  const [searchParams] = useSearchParams();
  const [workingDirectory, setWorkingDirectory] = useState(() =>
    defaultWorkingDirectory(searchParams.get("path")),
  );
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [manualContextPaths, setManualContextPaths] = useState<string[]>([]);
  const paramPaths = useMemo(() => {
    const raw = searchParams.get("paths");
    return raw
      ? raw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  }, [searchParams]);
  const selectedPaths = useMemo(
    () => [...new Set([...paramPaths, ...manualContextPaths])],
    [paramPaths, manualContextPaths],
  );
  const spaceId = searchParams.get("spaceId");
  const spaceName = useSpacesStore((state) =>
    spaceId ? (state.spaces.find((space) => space.id === spaceId)?.name ?? spaceId) : null,
  );

  const {
    status,
    mode,
    messages,
    plans,
    toolApprovals,
    error,
    refreshStatus,
    hydrateConversations,
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
      hydrateConversations: state.hydrateConversations,
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

  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const running = status?.running ?? false;
  const configured = status?.configured ?? false;
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const mikaAnimationSource = runtimeAssetSource(assetsDir, "animations/mika.webp");
  const mikaPeek = useMikaPeekAnimation(true);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  // Sessions live on the account, so a device that has never seen them still lists them.
  useEffect(() => {
    void hydrateConversations();
  }, [hydrateConversations]);
  useEffect(() => {
    syncForToday();
    const interval = window.setInterval(syncForToday, 60_000);
    return () => window.clearInterval(interval);
  }, [syncForToday]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const submitPrompt = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || running) return;
    setPrompt("");
    void sendPrompt({
      displayPrompt: trimmed,
      prompt: buildAssistantPrompt(trimmed, workingDirectory, selectedPaths, spaceName),
      cwd: workingDirectory || null,
      selectedPaths,
    });
  }, [prompt, running, selectedPaths, sendPrompt, spaceName, workingDirectory]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)] overflow-hidden max-[900px]:grid-cols-[minmax(0,1fr)]">
      <div className="min-h-0 max-[900px]:hidden">
        <AssistantSessionSidebar />
      </div>
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
            {/* The rail carries sessions on wide layouts; this is the narrow-window fallback. */}
            <span className="min-[901px]:hidden">
              <AssistantSessionSwitcher />
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {spaceName ? <Badge variant="outline">Space: {spaceName}</Badge> : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 max-w-[240px] gap-1.5 px-2.5 text-xs shadow-none"
              type="button"
              onClick={() => setFolderPickerOpen(true)}
              title="Choose the folder Mika should use as context"
            >
              <Folder size={12} className="shrink-0" />
              <span className="min-w-0 truncate">{workingDirectory || "Choose folder"}</span>
            </Button>
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

        {error ? <p className={assistantPanelStyles.errorText}>{error}</p> : null}

        <div ref={logRef} className={`${assistantPanelStyles.log} gap-2.5`} aria-live="polite">
          {messages.length === 0 ? (
            <MikaEmptyState />
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
            submitPrompt();
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
              className={[
                "max-h-[260px] min-h-[72px] w-full resize-none rounded-none border-0",
                "bg-transparent px-4 pb-2 pt-3.5 text-sm shadow-none focus-visible:ring-0",
              ].join(" ")}
              value={prompt}
              rows={3}
              placeholder={assistantPlaceholder(configured, "Ask Mika anything...")}
              disabled={!configured || running}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitPrompt();
                }
              }}
            />
            <AssistantComposerActions
              mode={mode}
              modelName={status?.modelName ?? "Mika"}
              configured={configured}
              running={running}
              prompt={prompt}
              setMode={setMode}
              abortPrompt={abortPrompt}
              onAddContext={() => setContextPickerOpen(true)}
            />
          </div>
        </form>

        {contextPickerOpen ? (
          <MistyPicker
            multiple
            title="Add files as context for Mika"
            onCancel={() => setContextPickerOpen(false)}
            onChooseFiles={(paths) => {
              setManualContextPaths((current) => [...new Set([...current, ...paths])]);
              setContextPickerOpen(false);
            }}
          />
        ) : null}

        {folderPickerOpen ? (
          <MistyFilePicker
            mode="folder"
            title="Choose a folder for Mika"
            initialPath={workingDirectory || null}
            onCancel={() => setFolderPickerOpen(false)}
            onSelect={(path) => {
              setWorkingDirectory(path);
              setFolderPickerOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function buildAssistantPrompt(
  userPrompt: string,
  workingDirectory: string,
  selectedPaths: string[],
  spaceName: string | null,
): string {
  const selectedContext =
    selectedPaths.length > 0
      ? [`Selected items (${selectedPaths.length}):`, ...selectedPaths.map((path) => `- ${path}`)]
      : ["Selected items: none"];
  const context = [
    "You are helping inside Misty, a desktop file manager, from the global Assistant surface.",
    "Mika is beta and experimental.",
    [
      "Your main goal is to help reorganize files. You may chat freely, but tool-assisted work",
      "should stay focused on listing, searching, validating, and proposing safe file organization plans.",
    ].join(" "),
    "Do not inspect file contents or ask for preview tools. For changes, propose a file plan with folders, moves, and renames for the user to review.",
    spaceName ? `Current Space: ${spaceName}` : null,
    workingDirectory ? `Current folder: ${workingDirectory}` : "Current folder: none",
    ...selectedContext,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return `${context}\n\nUser request:\n${userPrompt}`;
}
