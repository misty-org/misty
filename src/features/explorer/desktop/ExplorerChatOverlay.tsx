import { MessageSquare, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { useMikaSessionStore } from "../../../stores/useMikaSessionStore";
import { useMultiPanelStore } from "@/shared/multipanel/useMultiPanelStore";
import { AssistantMessage } from "./ExplorerAssistantMessage";
import {
  assistantPlaceholder,
  assistantStatusText,
  buildMikaPrompt,
  mikaSelectionSummary,
  selectedPathsAcrossPanes,
} from "./ExplorerAssistantShared";
import { assistantPanelStyles } from "./ExplorerAssistantStyles";

export const ExplorerChatOverlay = memo(function ExplorerChatOverlay() {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const panes = useExplorerStore((state) => state.panes);
  const listing = useExplorerStore((state) => state.panes[activePaneId]?.listing ?? null);
  const selectedPaths = useMemo(() => selectedPathsAcrossPanes(panes), [panes]);
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
    clearConversation,
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
      clearConversation: state.clearConversation,
      approvePlan: state.approvePlan,
      approveToolRequest: state.approveToolRequest,
    })),
  );
  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const workingDirectory = listing?.path ?? "";
  const running = status?.running ?? false;
  const configured = status?.configured ?? false;

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

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

  const openPanel = useCallback(() => {
    useExplorerStore.getState().toggleChatOverlay();
    useExplorerStore.getState().setMikaPanelOpen(true);
  }, []);

  const closeOverlay = useCallback(() => {
    useExplorerStore.getState().toggleChatOverlay();
    if (!running) clearConversation();
    setPrompt("");
  }, [clearConversation, running]);

  return (
    <section className={assistantPanelStyles.chatOverlay} aria-label="Explorer chat">
      <header className={assistantPanelStyles.header}>
        <span className={assistantPanelStyles.headerTitle}>
          <MessageSquare size={16} /> Chat
          {running ? <small className={assistantPanelStyles.runningBadge}>Running</small> : null}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={assistantPanelStyles.headerButton}
          type="button"
          aria-label="Close chat"
          onClick={closeOverlay}
        >
          <X size={16} />
        </Button>
      </header>
      <div className={assistantPanelStyles.chatBody}>
        <div className={`${assistantPanelStyles.status} ${assistantPanelStyles.chatStatus}`}>
          <dl className={assistantPanelStyles.chatDetails}>
            <dt className={assistantPanelStyles.detailLabel}>Status</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>{assistantStatusText(status)}</dd>
            <dt className={assistantPanelStyles.detailLabel}>Folder</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>
              {workingDirectory || "No active folder"}
            </dd>
            <dt className={assistantPanelStyles.detailLabel}>Selection</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>
              {mikaSelectionSummary(selectedPaths)}
            </dd>
          </dl>
          {error ? <p className={assistantPanelStyles.errorText}>{error}</p> : null}
        </div>
        <div
          ref={logRef}
          className={`${assistantPanelStyles.log} ${assistantPanelStyles.chatLog}`}
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <p className={assistantPanelStyles.emptyLog}>
              Ask Mika about the current folder or selection.
            </p>
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
          className={`${assistantPanelStyles.composer} ${assistantPanelStyles.chatComposer}`}
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <Textarea
            className={assistantPanelStyles.textarea}
            value={prompt}
            rows={3}
            placeholder={assistantPlaceholder(configured, "Ask Mika to organize files...")}
            disabled={!configured || running}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitPrompt();
              }
            }}
          />
          <div className={assistantPanelStyles.composerActions}>
            <Select
              value={mode === "full" ? "auto" : mode}
              onValueChange={(value) => setMode(value as Parameters<typeof setMode>[0])}
            >
              <SelectTrigger className="h-8 w-28" aria-label="Mika mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">Ask first</SelectItem>
                <SelectItem value="auto">Full access</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" type="button" onClick={openPanel}>
              Open Panel
            </Button>
            {running ? (
              <Button
                size="sm"
                type="button"
                title="Cancel the active Mika gateway request."
                onClick={abortPrompt}
              >
                Stop
              </Button>
            ) : (
              <Button size="sm" type="submit" disabled={!configured || !prompt.trim()}>
                Send
              </Button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
});
