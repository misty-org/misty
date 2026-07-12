import { ArrowUp, Copy, File, Folder, Info, MessageSquare, Sparkles, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useShallow } from "zustand/react/shallow";
import { selectedPathsForPane, useExplorerStore } from "../../../stores/useExplorerStore";
import { useMikaSessionStore } from "../../../stores/useMikaSessionStore";
import type { AiPlanReview, AiStatus, AiToolApproval } from "../../../stores/useMikaSessionStore";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { errorText } from "../../../shared/format";
import { cx } from "./ExplorerDesktopShared";

export const assistantPanelStyles = {
  mikaResizer:
    "absolute bottom-[22px] right-[var(--mika-panel-width,380px)] top-[46px] z-[21] w-[5px] cursor-col-resize bg-transparent after:absolute after:bottom-0 after:left-1/2 after:top-0 after:w-px after:-translate-x-1/2 after:bg-transparent after:content-[''] hover:after:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] max-[720px]:hidden",
  mikaPanel:
    "absolute bottom-[22px] right-0 top-[46px] z-20 grid w-[min(var(--mika-panel-width,380px),calc(100%_-_48px))] min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden border-l border-t border-[var(--misty-border-soft)] bg-[var(--misty-app-pane-bg,var(--misty-surface))] text-[#e2e2e2] shadow-[-18px_0_38px_rgba(0,0,0,0.42)] max-[720px]:top-[38px]",
  mikaBotPanel:
    "fixed bottom-5 right-5 top-[48px] z-[2147482500] grid w-[min(440px,calc(100vw_-_112px))] min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-pane-bg,var(--misty-surface))] text-[#e2e2e2] shadow-[0_28px_90px_rgba(0,0,0,0.62)] max-[720px]:bottom-3 max-[720px]:right-3 max-[720px]:top-10 max-[720px]:w-[calc(100vw_-_88px)]",
  mikaBotWindowPanel:
    "pointer-events-auto absolute bottom-[142px] left-2 right-2 top-2 z-20 grid min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-white/10 bg-[rgba(7,8,10,0.96)] text-[#e2e2e2] shadow-[0_28px_72px_rgba(0,0,0,0.58)] backdrop-blur-xl",
  chatOverlay:
    "absolute bottom-[76px] right-[18px] z-[19] grid max-h-[min(620px,calc(100vh_-_120px))] w-[min(420px,calc(100vw_-_180px))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-[#323232] bg-[rgba(17, 17, 17, 0.96)] text-[#e2e2e2] shadow-[0_18px_42px_rgba(0,0,0,0.44)]",
  header:
    "flex h-[42px] min-w-0 items-center justify-between gap-2.5 border-b border-[#292929] py-0 pr-2.5",
  chatHeader: "pl-[13px]",
  mikaHeader: "pl-3.5",
  mikaPanelHeader:
    "relative !h-[54px] border-b border-transparent bg-[rgba(7,8,10,0.96)] !pl-5 pr-3",
  headerTitle:
    "inline-flex min-w-0 items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap font-semibold",
  mikaHeaderTitle:
    "gap-3 text-[19px] font-bold text-[#f4f4f4] [&_svg]:text-[#f2f2f2]",
  headerActions: "flex flex-none items-center gap-1.5",
  runningBadge: "text-[11px] font-semibold text-[#c1c1c1]",
  headerButton:
    "inline-flex size-[30px] flex-none items-center justify-center gap-2 rounded-lg border-0 bg-transparent p-0 text-[#b3b3b3] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[#f7f7f7]",
  mikaHeaderButton:
    "size-9 rounded-[10px] border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] text-[#b9bcc4] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[#f7f7f7] aria-expanded:bg-[var(--misty-neutral-selected-bg,var(--misty-surface-selected))] aria-expanded:text-[#f7f7f7]",
  contextPopover:
    "absolute right-3 top-[62px] z-30 grid w-[min(360px,calc(100vw_-_32px))] gap-3 rounded-xl border border-[#2c3036] bg-[rgba(9,10,12,0.98)] p-3.5 text-[#e2e2e2] shadow-[0_20px_54px_rgba(0,0,0,0.56)]",
  contextSection: "grid gap-1.5 border-b border-[#24262a] pb-3 last:border-b-0 last:pb-0",
  contextLabel: "text-[11px] font-bold uppercase tracking-normal text-[#8e929a]",
  contextValueRow: "grid grid-cols-[22px_minmax(0,1fr)_34px] items-center gap-2",
  contextValueText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[#f1f1f1]",
  contextSubText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#8f939b]",
  contextCopyButton:
    "grid size-8 place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] text-[#b9bcc4] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[#f7f7f7]",
  statusDot: "size-2.5 rounded-full bg-[#46d05a] shadow-[0_0_14px_rgba(70,208,90,0.48)]",
  chatBody:
    "grid min-h-0 grid-rows-[auto_minmax(90px,1fr)_auto] gap-2.5 overflow-hidden p-[13px]",
  mikaBody:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-3 overflow-hidden bg-[var(--misty-app-pane-bg,var(--misty-surface))] p-5",
  status:
    "grid border-b border-[#292929]",
  chatStatus: "gap-2 pb-2.5",
  mikaStatus: "gap-2.5 pb-3",
  chatDetails:
    "m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5",
  mikaDetails: "m-0 grid gap-[7px]",
  betaNotice:
    "m-0 grid grid-cols-[24px_minmax(0,1fr)] items-start gap-3 rounded-xl border border-[#6f4f19] bg-[rgba(27,20,8,0.64)] px-4 py-3.5 text-sm font-medium leading-relaxed text-[#e8ded0] shadow-[0_0_28px_rgba(111,79,25,0.08)_inset]",
  betaIcon: "mt-0.5 text-[#efb33d]",
  detailLabel: "text-[#898989]",
  mikaDetailLabel: "text-xs uppercase",
  chatDetailValue:
    "m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  mikaDetailValue: "m-0 min-w-0 break-words",
  errorText: "m-0 text-[#b0b0b0]",
  log:
    "grid min-h-0 content-start overflow-auto pr-0.5",
  chatLog: "gap-2",
  mikaLog: "min-w-0 gap-2.5",
  mikaEmpty:
    "grid min-h-0 place-items-center px-3 py-8 text-center",
  mikaEmptyInner: "grid max-w-[260px] justify-items-center gap-3",
  mikaEmptyIcon:
    "relative grid size-[74px] place-items-center rounded-[24px] border border-[#3a3d44] bg-[linear-gradient(145deg,#17191e,#0b0c0f)] text-[#bfc3ca] shadow-[0_18px_42px_rgba(0,0,0,0.34)]",
  mikaEmptySpark: "absolute -right-1 top-0 text-[#ffd76b]",
  mikaEmptyTitle: "m-0 text-[22px] font-bold leading-tight text-[#f3f3f3]",
  mikaEmptyText: "m-0 text-sm leading-relaxed text-[#94979f]",
  emptyLog: "m-[18px] text-[var(--misty-text-muted)]",
  message:
    "grid min-w-0 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))]",
  chatMessage: "gap-[5px] p-[9px]",
  mikaMessage: "gap-1.5 p-2.5",
  userMessage: "border-[var(--misty-neutral-border,var(--misty-border-strong))] bg-[var(--misty-neutral-selected-bg,var(--misty-surface-selected))]",
  toolMessage: "border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))]",
  errorMessage: "border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))]",
  planDetails: "grid min-w-0 gap-2",
  planActions: "flex flex-wrap items-center gap-2",
  planTableWrap:
    "min-h-0 overflow-auto rounded-lg border border-[#2f2f2f] bg-[#101010]",
  planTable:
    "w-full min-w-[760px] border-separate border-spacing-0 text-left text-xs",
  planTableHead:
    "sticky top-0 z-[1] bg-[#151515] text-[11px] font-bold uppercase text-[#9f9f9f]",
  planTableHeaderCell:
    "border-b border-[#2f2f2f] px-3 py-2",
  planTableRow:
    "align-top text-[#d4d4d4] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))]",
  planTableCell:
    "border-b border-[#242424] px-3 py-2.5 last:border-b-[#242424]",
  planTableOperation: "font-bold uppercase text-[#f0f0f0]",
  planTablePath: "min-w-0 break-words leading-normal text-[#d2d2d2]",
  planTableReason: "min-w-0 break-words leading-normal text-[#9f9f9f]",
  planWarningText: "m-0 text-xs leading-normal text-[#f0b3b3]",
  reviewLayer:
    "fixed inset-0 z-[2147482600] grid place-items-center bg-[rgba(0,0,0,0.66)] p-8 text-[#e2e2e2] backdrop-blur-[10px]",
  reviewPanel:
    "grid h-[min(720px,calc(100vh-64px))] w-[min(900px,calc(100vw-64px))] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-[#242529] bg-[#07090b] shadow-[0_28px_90px_rgba(0,0,0,0.62)]",
  reviewHeader:
    "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-[#242529] px-5 py-4",
  reviewTitle: "m-0 text-[18px] font-semibold leading-tight text-[#f4f4f4]",
  reviewSubtitle: "m-0 mt-1 min-w-0 break-words text-sm leading-normal text-[#9f9f9f]",
  reviewBody: "grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden p-5",
  reviewSummaryGrid: "grid gap-3",
  reviewSummaryBlock:
    "grid gap-1 rounded-lg border border-[#242529] bg-[#0d0f12] px-3.5 py-3",
  reviewSummaryLabel:
    "text-[11px] font-bold uppercase text-[#8f8f8f]",
  reviewSummaryText:
    "m-0 min-w-0 break-words text-sm leading-normal text-[#d7d7d7]",
  reviewFooter:
    "flex flex-wrap items-center justify-between gap-3 border-t border-[#242529] px-5 py-4",
  reviewFooterActions: "flex flex-wrap justify-end gap-2",
  modeSelect:
    "min-h-8 rounded-lg border border-[#3f3f3f] bg-[#171717] px-2 text-[#f7f7f7] outline-none",
  messageTitle: "text-xs text-[#f7f7f7]",
  messageText:
    "m-0 whitespace-pre-wrap break-words font-[inherit] leading-normal text-[#d4d4d4]",
  composer:
    "grid border-t border-[#292929]",
  chatComposer: "gap-[9px] pt-2.5",
  mikaComposer: "gap-2.5 pt-3",
  textarea:
    "min-w-0 resize-y rounded-xl border border-[#343840] bg-[rgba(7,8,10,0.92)] px-3.5 py-3 font-[inherit] leading-snug text-[#f7f7f7] outline-none placeholder:text-[#777b84] focus:border-[#6a707c] focus:shadow-[0_0_0_3px_rgba(122,129,143,0.16)] disabled:text-[#898989]",
  composerActions: "flex justify-end gap-2",
  mikaComposerActions: "gap-2",
  composerButton:
    "min-h-8 rounded-lg border border-[#3f3f3f] bg-[#252525] px-3 font-semibold text-[#f7f7f7] hover:not-disabled:bg-[#303030] disabled:opacity-55",
  mikaComposerButton: "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5",
  mikaPrimaryButton:
    "border-[#ececec] bg-[#e8e8e8] text-[#242424] hover:not-disabled:bg-[#f5f5f5]",
  mikaFooter:
    "flex min-h-10 items-center justify-center gap-2 border-t border-[#24262a] pt-3 text-xs font-semibold text-[#777b84]",
  secondaryButton: "bg-transparent text-[#b3b3b3]",
} as const;

function assistantStatusText(status: AiStatus | null): string {
  if (!status) return "Checking Mika...";
  if (status.configured) return `Ready (${status.modelName})`;
  return "Backend unavailable";
}

function assistantPlaceholder(configured: boolean, fallback: string): string {
  return configured ? fallback : "Configure Mika backend to continue";
}

function assistantMessageClass(role: string, density: "chat" | "mika"): string {
  return cx(
    assistantPanelStyles.message,
    density === "chat" ? assistantPanelStyles.chatMessage : assistantPanelStyles.mikaMessage,
    role === "user" && assistantPanelStyles.userMessage,
    role === "tool" && assistantPanelStyles.toolMessage,
    role === "error" && assistantPanelStyles.errorMessage,
  );
}

export const ExplorerChatOverlay = memo(function ExplorerChatOverlay() {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const panes = useExplorerStore((state) => state.panes);
  const listing = useExplorerStore((state) => state.panes[activePaneId]?.listing ?? null);
  const selectedPaths = useMemo(() => selectedPathsAcrossPanes(panes), [panes]);
  const { status, mode, messages, plans, toolApprovals, error, refreshStatus, setMode, sendPrompt, abortPrompt, clearConversation, approvePlan, approveToolRequest } = useMikaSessionStore(useShallow((state) => ({
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
  })));
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
    if (!running) {
      clearConversation();
    }
    setPrompt("");
  }, [clearConversation, running]);

  return (
    <section className={assistantPanelStyles.chatOverlay} aria-label="Explorer chat">
      <header className={cx(assistantPanelStyles.header, assistantPanelStyles.chatHeader)}>
        <span className={assistantPanelStyles.headerTitle}>
          <MessageSquare size={16} />
          Chat
          {running ? <small className={assistantPanelStyles.runningBadge}>Running</small> : null}
        </span>
        <button className={assistantPanelStyles.headerButton} type="button" aria-label="Close chat" onClick={closeOverlay}>
          <X size={16} />
        </button>
      </header>
      <div className={assistantPanelStyles.chatBody}>
        <div className={cx(assistantPanelStyles.status, assistantPanelStyles.chatStatus)}>
          <dl className={assistantPanelStyles.chatDetails}>
            <dt className={assistantPanelStyles.detailLabel}>Status</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>{assistantStatusText(status)}</dd>
            <dt className={assistantPanelStyles.detailLabel}>Folder</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>{workingDirectory || "No active folder"}</dd>
            <dt className={assistantPanelStyles.detailLabel}>Selection</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>{mikaSelectionSummary(selectedPaths)}</dd>
          </dl>
          {error ? <p className={assistantPanelStyles.errorText}>{error}</p> : null}
        </div>
        <div ref={logRef} className={cx(assistantPanelStyles.log, assistantPanelStyles.chatLog)} aria-live="polite">
          {messages.length === 0 ? (
            <p className={assistantPanelStyles.emptyLog}>Ask Mika about the current folder or selection.</p>
          ) : messages.map((message) => (
            <article key={message.id} className={assistantMessageClass(message.role, "chat")}>
              <strong className={assistantPanelStyles.messageTitle}>{message.role === "user" ? "You" : message.role === "tool" ? "Tool" : message.role === "error" ? "Error" : "Mika"}</strong>
              <pre className={assistantPanelStyles.messageText}>{message.text || (message.role === "assistant" && running ? "Thinking..." : "")}</pre>
              {message.creditsUsed !== undefined ? <small className="text-[10px] text-[#858993]">{message.creditsUsed} credits · {message.creditsRemaining?.toLocaleString() ?? 0} remaining</small> : null}
              {message.toolRequestId ? <AssistantToolActions requestId={message.toolRequestId} approvals={toolApprovals} onApprove={approveToolRequest} /> : null}
              {message.planId ? <AssistantPlanActions planId={message.planId} plans={plans} onApply={approvePlan} /> : null}
            </article>
          ))}
        </div>
        <form
          className={cx(assistantPanelStyles.composer, assistantPanelStyles.chatComposer)}
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <textarea
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
            <select className={assistantPanelStyles.modeSelect} value={mode} aria-label="Mika mode" onChange={(event) => setMode(event.target.value as Parameters<typeof setMode>[0])}>
              <option value="ask">Ask</option>
              <option value="auto">Auto</option>
            </select>
            <button type="button" className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.secondaryButton)} onClick={openPanel}>Open Panel</button>
            {running ? (
              <button className={assistantPanelStyles.composerButton} type="button" title="Cancel the active Mika gateway request." onClick={abortPrompt}>Stop</button>
            ) : (
              <button className={assistantPanelStyles.composerButton} type="submit" disabled={!configured || !prompt.trim()}>Send</button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
});

export const ExplorerMikaPanel = memo(function ExplorerMikaPanel(props: {
  surface?: "explorer" | "bot" | "bot-window";
  onClose?: () => void;
  workingDirectory?: string;
  selectedPaths?: string[];
}) {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const panes = useExplorerStore((state) => state.panes);
  const listing = useExplorerStore((state) => state.panes[activePaneId]?.listing ?? null);
  const explorerSelectedPaths = useMemo(() => selectedPathsAcrossPanes(panes), [panes]);
  const selectedPaths = props.selectedPaths ?? explorerSelectedPaths;
  const { status, mode, messages, plans, toolApprovals, error, refreshStatus, setMode, sendPrompt, abortPrompt, approvePlan, approveToolRequest } = useMikaSessionStore(useShallow((state) => ({
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
  })));
  const [prompt, setPrompt] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef<HTMLDivElement | null>(null);
  const workingDirectory = props.workingDirectory ?? listing?.path ?? "";
  const running = status?.running ?? false;
  const configured = status?.configured ?? false;

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!contextOpen) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && contextRef.current?.contains(target)) return;
      setContextOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextOpen]);

  const submitPrompt = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || running) return;
    const requestPrompt = buildMikaPrompt(trimmed, workingDirectory, selectedPaths);
    setPrompt("");
    void sendPrompt({
      displayPrompt: trimmed,
      prompt: requestPrompt,
      cwd: workingDirectory || null,
      selectedPaths,
    });
  }, [prompt, running, selectedPaths, sendPrompt, workingDirectory]);

  return (
    <aside className={props.surface === "bot-window" ? assistantPanelStyles.mikaBotWindowPanel : props.surface === "bot" ? assistantPanelStyles.mikaBotPanel : assistantPanelStyles.mikaPanel} aria-label="Mika Assistant">
      <header className={cx(assistantPanelStyles.header, assistantPanelStyles.mikaHeader, assistantPanelStyles.mikaPanelHeader)}>
        <span className={cx(assistantPanelStyles.headerTitle, assistantPanelStyles.mikaHeaderTitle)}>
          <MessageSquare size={24} strokeWidth={1.9} />
          Mika
          {running ? <small className={assistantPanelStyles.runningBadge}>Running</small> : null}
        </span>
        <div ref={contextRef} className={assistantPanelStyles.headerActions}>
          <button
            className={cx(assistantPanelStyles.headerButton, assistantPanelStyles.mikaHeaderButton)}
            type="button"
            aria-label="Mika context"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen((open) => !open)}
          >
            <Info size={17} />
          </button>
          <button className={cx(assistantPanelStyles.headerButton, assistantPanelStyles.mikaHeaderButton)} type="button" aria-label="Close Mika" onClick={props.onClose ?? (() => useExplorerStore.getState().setMikaPanelOpen(false))}>
            <X size={18} />
          </button>
          {contextOpen ? (
            <MikaContextPopover
              status={status}
              workingDirectory={workingDirectory}
              selectedPaths={selectedPaths}
            />
          ) : null}
        </div>
      </header>
      <div className={assistantPanelStyles.mikaBody}>
        {error ? (
          <div className={cx(assistantPanelStyles.status, assistantPanelStyles.mikaStatus)}>
            <p className={assistantPanelStyles.errorText}>{error}</p>
          </div>
        ) : null}
        <div ref={logRef} className={cx(assistantPanelStyles.log, assistantPanelStyles.mikaLog)} aria-live="polite">
          {messages.length === 0 ? (
            <MikaEmptyState />
          ) : messages.map((message) => (
            <article key={message.id} className={assistantMessageClass(message.role, "mika")}>
              <strong className={assistantPanelStyles.messageTitle}>{message.role === "user" ? "You" : message.role === "tool" ? "Tool" : message.role === "error" ? "Error" : "Mika"}</strong>
              <pre className={assistantPanelStyles.messageText}>{message.text || (message.role === "assistant" && running ? "Thinking..." : "")}</pre>
              {message.creditsUsed !== undefined ? <small className="text-[10px] text-[#858993]">{message.creditsUsed} credits · {message.creditsRemaining?.toLocaleString() ?? 0} remaining</small> : null}
              {message.toolRequestId ? <AssistantToolActions requestId={message.toolRequestId} approvals={toolApprovals} onApprove={approveToolRequest} /> : null}
              {message.planId ? <AssistantPlanActions planId={message.planId} plans={plans} onApply={approvePlan} /> : null}
            </article>
          ))}
        </div>
        <form
          className={cx(assistantPanelStyles.composer, assistantPanelStyles.mikaComposer)}
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <textarea
            className={assistantPanelStyles.textarea}
            value={prompt}
            rows={3}
            placeholder={assistantPlaceholder(configured, "Ask Mika to organize this folder...")}
            disabled={!configured || running}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitPrompt();
              }
            }}
          />
          <div className={cx(assistantPanelStyles.composerActions, assistantPanelStyles.mikaComposerActions)}>
            <select className={assistantPanelStyles.modeSelect} value={mode} aria-label="Mika mode" onChange={(event) => setMode(event.target.value as Parameters<typeof setMode>[0])}>
              <option value="ask">Ask</option>
              <option value="auto">Auto</option>
            </select>
            {running ? (
              <button className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.mikaComposerButton)} type="button" title="Cancel the active Mika gateway request." onClick={abortPrompt}>Stop</button>
            ) : (
              <button className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.mikaComposerButton, assistantPanelStyles.mikaPrimaryButton)} type="submit" disabled={!configured || !prompt.trim()}>
                <ArrowUp size={17} />
                Send
              </button>
            )}
          </div>
        </form>
        <footer className={assistantPanelStyles.mikaFooter}>
          <Sparkles size={15} />
          Mika can make mistakes. Review file plans before applying them.
        </footer>
      </div>
    </aside>
  );
});

function AssistantPlanActions(props: {
  planId: string;
  plans: AiPlanReview[];
  onApply: (planId: string) => Promise<void>;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const plan = props.plans.find((candidate) => candidate.id === props.planId);
  if (!plan) return null;
  const blocked = plan.blockedReasons.length > 0;
  return (
    <div className={assistantPanelStyles.planDetails}>
      <div className={assistantPanelStyles.planActions}>
        <span className={assistantPanelStyles.runningBadge}>
          {plan.plan.operations.length} operations{blocked ? " blocked" : plan.applied ? " queued" : ""}
        </span>
        <button
          className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.secondaryButton)}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setReviewOpen(true)}
        >
          {plan.applied ? "View" : "Review & Apply"}
        </button>
      </div>
      {reviewOpen ? (
        <AssistantPlanReviewDialog
          plan={plan}
          onApply={props.onApply}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}
    </div>
  );
}

type AssistantPlanOperation = AiPlanReview["plan"]["operations"][number];

function planOperationDetail(operation: AssistantPlanOperation): string {
  if (operation.type === "mkdir") return operation.path;
  return `${operation.from} -> ${operation.to}`;
}

function planOperationSource(operation: AssistantPlanOperation): string {
  if (operation.type === "mkdir") return "-";
  return operation.from;
}

function planOperationDestination(operation: AssistantPlanOperation): string {
  if (operation.type === "mkdir") return operation.path;
  return operation.to;
}

function AssistantPlanReviewDialog(props: {
  plan: AiPlanReview;
  onApply: (planId: string) => Promise<void>;
  onClose: () => void;
}) {
  const blocked = props.plan.blockedReasons.length > 0;
  const warnings = [
    ...props.plan.plan.warnings.map((warning) => `Warning: ${warning}`),
    ...props.plan.blockedReasons.map((reason) => `Blocked: ${reason}`),
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  const applyPlan = async () => {
    await props.onApply(props.plan.id);
    props.onClose();
  };

  return createPortal(
    <div
      className={assistantPanelStyles.reviewLayer}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section className={assistantPanelStyles.reviewPanel} role="dialog" aria-modal="true" aria-labelledby="mika-plan-review-title">
        <header className={assistantPanelStyles.reviewHeader}>
          <div>
            <h2 className={assistantPanelStyles.reviewTitle} id="mika-plan-review-title">Review File Operations</h2>
            <p className={assistantPanelStyles.reviewSubtitle}>{props.plan.plan.operations.length} proposed operations</p>
          </div>
          <button className={assistantPanelStyles.headerButton} type="button" aria-label="Close review" onClick={props.onClose}>
            <X size={16} />
          </button>
        </header>
        <div className={assistantPanelStyles.reviewBody}>
          <div className={assistantPanelStyles.reviewSummaryGrid}>
            <section className={assistantPanelStyles.reviewSummaryBlock} aria-label="Summary of what Mika will do">
              <span className={assistantPanelStyles.reviewSummaryLabel}>What Mika Will Do</span>
              <p className={assistantPanelStyles.reviewSummaryText}>{props.plan.plan.summary}</p>
            </section>
            {props.plan.appliedSummary ? (
              <section className={assistantPanelStyles.reviewSummaryBlock} aria-label="Summary of what Misty queued">
                <span className={assistantPanelStyles.reviewSummaryLabel}>What Misty Queued</span>
                <p className={assistantPanelStyles.reviewSummaryText}>{props.plan.appliedSummary}</p>
              </section>
            ) : null}
          </div>
          {warnings.length > 0 ? (
            <p className={assistantPanelStyles.planWarningText}>{warnings.join(" ")}</p>
          ) : null}
          <div className={assistantPanelStyles.planTableWrap}>
            <table className={assistantPanelStyles.planTable}>
              <thead className={assistantPanelStyles.planTableHead}>
                <tr>
                  <th className={assistantPanelStyles.planTableHeaderCell} scope="col">Operation</th>
                  <th className={assistantPanelStyles.planTableHeaderCell} scope="col">Source</th>
                  <th className={assistantPanelStyles.planTableHeaderCell} scope="col">Destination</th>
                  <th className={assistantPanelStyles.planTableHeaderCell} scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {props.plan.plan.operations.map((operation, index) => (
                  <tr key={`${operation.type}-${index}-${planOperationDetail(operation)}`} className={assistantPanelStyles.planTableRow}>
                    <td className={cx(assistantPanelStyles.planTableCell, assistantPanelStyles.planTableOperation)}>{operation.type}</td>
                    <td className={cx(assistantPanelStyles.planTableCell, assistantPanelStyles.planTablePath)}>{planOperationSource(operation)}</td>
                    <td className={cx(assistantPanelStyles.planTableCell, assistantPanelStyles.planTablePath)}>{planOperationDestination(operation)}</td>
                    <td className={cx(assistantPanelStyles.planTableCell, assistantPanelStyles.planTableReason)}>{operation.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <footer className={assistantPanelStyles.reviewFooter}>
          <span className={assistantPanelStyles.runningBadge}>
            {props.plan.plan.operations.length} operations{blocked ? " blocked" : props.plan.applied ? " queued" : ""}
          </span>
          <div className={assistantPanelStyles.reviewFooterActions}>
            <button className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.secondaryButton)} type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button
              className={assistantPanelStyles.composerButton}
              type="button"
              disabled={blocked || props.plan.applied || props.plan.applying}
              onClick={() => void applyPlan()}
            >
              {props.plan.applying ? "Queueing..." : props.plan.applied ? "Queued" : "Apply"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function AssistantToolActions(props: {
  requestId: string;
  approvals: AiToolApproval[];
  onApprove: (requestId: string) => Promise<void>;
}) {
  const approval = props.approvals.find((candidate) => candidate.id === props.requestId);
  if (!approval) return null;
  return (
    <div className={assistantPanelStyles.planActions}>
      <span className={assistantPanelStyles.runningBadge}>
        {approval.completed ? "Completed" : approval.error ? "Blocked" : "Needs approval"}
      </span>
      <button
        className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.secondaryButton)}
        type="button"
        disabled={approval.running || approval.completed}
        onClick={() => void props.onApprove(props.requestId)}
      >
        {approval.running ? "Running..." : approval.completed ? "Ran" : "Run"}
      </button>
    </div>
  );
}

function MikaContextPopover(props: {
  status: AiStatus | null;
  workingDirectory: string;
  selectedPaths: string[];
}) {
  const configured = props.status?.configured ?? false;
  const statusLabel = props.status
    ? configured ? "Ready" : "Not configured"
    : "Checking";
  const statusMeta = props.status && configured ? props.status.modelName : "";
  const selectionText = props.selectedPaths.length > 0 ? props.selectedPaths.join("\n") : "";
  const firstSelection = props.selectedPaths[0] ?? "";
  return (
    <div className={assistantPanelStyles.contextPopover} role="dialog" aria-label="Mika context">
      <section className={assistantPanelStyles.contextSection}>
        <span className={assistantPanelStyles.contextLabel}>Status</span>
        <div className={assistantPanelStyles.contextValueRow}>
          <span className={assistantPanelStyles.statusDot} />
          <span className={assistantPanelStyles.contextValueText}>
            {statusLabel}
            {statusMeta ? <small className="ml-2 text-[#8f939b]">{statusMeta}</small> : null}
          </span>
          <span />
        </div>
      </section>
      <section className={assistantPanelStyles.contextSection}>
        <span className={assistantPanelStyles.contextLabel}>Working Directory</span>
        <div className={assistantPanelStyles.contextValueRow}>
          <Folder size={20} className="text-[#c8ccd4]" />
          <span className={assistantPanelStyles.contextValueText} title={props.workingDirectory || undefined}>
            {props.workingDirectory || "No active folder"}
          </span>
          <button
            className={assistantPanelStyles.contextCopyButton}
            type="button"
            aria-label="Copy working directory"
            disabled={!props.workingDirectory}
            onClick={() => void copyMikaContextValue(props.workingDirectory, "Working directory")}
          >
            <Copy size={16} />
          </button>
        </div>
      </section>
      <section className={assistantPanelStyles.contextSection}>
        <span className={assistantPanelStyles.contextLabel}>Selection</span>
        <div className={assistantPanelStyles.contextValueRow}>
          <File size={20} className="text-[#c8ccd4]" />
          <span className="grid min-w-0 gap-0.5">
            <strong className={assistantPanelStyles.contextValueText} title={firstSelection || undefined}>
              {mikaSelectionSummary(props.selectedPaths)}
            </strong>
            {firstSelection ? (
              <small className={assistantPanelStyles.contextSubText} title={firstSelection}>{firstSelection}</small>
            ) : null}
          </span>
          <button
            className={assistantPanelStyles.contextCopyButton}
            type="button"
            aria-label="Copy selection"
            disabled={!selectionText}
            onClick={() => void copyMikaContextValue(selectionText, "Selection")}
          >
            <Copy size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}

function MikaEmptyState() {
  return (
    <div className={assistantPanelStyles.mikaEmpty}>
      <div className={assistantPanelStyles.mikaEmptyInner}>
        <span className={assistantPanelStyles.mikaEmptyIcon}>
          <MessageSquare size={42} strokeWidth={1.5} />
          <Sparkles className={assistantPanelStyles.mikaEmptySpark} size={18} />
        </span>
        <h3 className={assistantPanelStyles.mikaEmptyTitle}>Ask Mika</h3>
        <p className={assistantPanelStyles.mikaEmptyText}>Start with the current folder or selected files.</p>
      </div>
    </div>
  );
}

async function copyMikaContextValue(value: string, label: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    await writeText(trimmed);
    useExplorerStore.getState().pushNotification(`${label} copied.`, "success");
  } catch (error) {
    useExplorerStore.getState().pushNotification(errorText(error), "error");
  }
}

function selectedPathsAcrossPanes(panes: ReturnType<typeof useExplorerStore.getState>["panes"]): string[] {
  const selected = new Set<string>();
  for (const pane of Object.values(panes)) {
    for (const path of selectedPathsForPane(pane)) {
      if (path) selected.add(path);
    }
  }
  return [...selected];
}

export function selectedCountAcrossPanes(panes: ReturnType<typeof useExplorerStore.getState>["panes"]): number {
  return selectedPathsAcrossPanes(panes).length;
}

export function clearSelectionsAcrossPanes(): void {
  const store = useExplorerStore.getState();
  for (const paneId of Object.keys(store.panes)) {
    store.clearSelection(paneId);
  }
}

function mikaSelectionSummary(selectedPaths: string[]): string {
  if (selectedPaths.length === 0) return "None";
  if (selectedPaths.length === 1) return titleFromPath(selectedPaths[0]);
  return `${selectedPaths.length} items selected`;
}

function buildMikaPrompt(userPrompt: string, workingDirectory: string, selectedPaths: string[]): string {
  const selectedContext = selectedPaths.length > 0
    ? [`Selected items (${selectedPaths.length}):`, ...selectedPaths.map((path) => `- ${path}`)]
    : ["Selected items: none"];
  const context = [
    "You are helping inside Misty, a desktop file manager.",
    "Mika is beta and experimental.",
    "Your main goal is to help reorganize files. You may chat freely, but tool-assisted work should stay focused on listing, searching, validating, and proposing safe file organization plans.",
    "Do not inspect file contents or ask for preview tools. For changes, propose a file plan with folders, moves, and renames for the user to review.",
    workingDirectory ? `Current folder: ${workingDirectory}` : "Current folder: none",
    ...selectedContext,
  ].join("\n");
  return `${context}\n\nUser request:\n${userPrompt}`;
}

function titleFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path || "Home";
}
