import { AlertCircle, ArrowUp, Check, ChevronDown, Cloud, Copy, File, Folder, FolderSearch, HardDrive, Images, Info, MessageSquare, Mic, Plus, RefreshCw, Search, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import mikaAnimation from "../../../assets/bots/cloud-folder/mika.webp";
import { useAppStore } from "../../../stores/useAppStore";
import { selectedPathsForPane, useExplorerStore } from "../../../stores/useExplorerStore";
import { useMikaSessionStore } from "../../../stores/useMikaSessionStore";
import { useSmartLibraryStore } from "../../../stores/useSmartLibraryStore";
import type { AiPlanReview, AiStatus, AiToolApproval } from "../../../stores/useMikaSessionStore";
import type { SmartLibraryAsset } from "../../../api/types";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { errorText } from "../../../shared/format";
import { safeTauriAssetUrl } from "../../../shared/tauri";
import { restoreBundledAssetOnError, runtimeAssetSource } from "../../../shared/assets/runtimeAsset";
import { cx } from "./ExplorerDesktopShared";
import { AgentSources } from "../../../agents/AgentSources";
import { MikaDelegatedRunAction } from "./MikaDelegatedRunAction";
import "../../../agents/sources.css";
export const assistantPanelStyles = {
  mikaResizer:
    "absolute bottom-[22px] right-[var(--mika-panel-width,380px)] top-[46px] z-[21] w-[5px] cursor-col-resize bg-transparent after:absolute after:bottom-0 after:left-1/2 after:top-0 after:w-px after:-translate-x-1/2 after:bg-transparent after:content-[''] hover:after:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] max-[720px]:hidden",
  mikaPanel:
    "absolute bottom-[22px] right-0 top-[46px] z-20 grid w-[min(var(--mika-panel-width,380px),calc(100%_-_48px))] min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden border-l border-t border-[var(--misty-border-soft)] bg-[var(--misty-app-pane-bg,var(--misty-surface))] text-[#e2e2e2] shadow-[-18px_0_38px_rgba(0,0,0,0.42)] max-[720px]:top-[38px]",
  mikaBotPanel:
    "fixed bottom-5 right-5 top-[calc(var(--misty-window-titlebar-inset)+20px)] z-[2147482500] grid w-[min(440px,calc(100vw_-_112px))] min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-pane-bg,var(--misty-surface))] text-[#e2e2e2] shadow-[0_28px_90px_rgba(0,0,0,0.62)] max-[720px]:bottom-3 max-[720px]:right-3 max-[720px]:top-[calc(var(--misty-window-titlebar-inset)+12px)] max-[720px]:w-[calc(100vw_-_88px)]",
  mikaBotWindowPanel:
    "pointer-events-auto absolute bottom-[142px] left-2 right-2 top-2 z-20 grid min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-white/10 bg-[rgba(7,8,10,0.96)] text-[#e2e2e2] shadow-[0_28px_72px_rgba(0,0,0,0.58)] backdrop-blur-xl",
  mikaChatWindowPanel:
    "pointer-events-auto absolute inset-0 z-20 grid min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-white/10 bg-[#07080a] text-[#e2e2e2]",
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
  contextLabel: "text-[11px] font-bold capitalize text-[#8e929a]",
  contextValueRow: "grid grid-cols-[22px_minmax(0,1fr)_34px] items-center gap-2",
  contextValueText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[#f1f1f1]",
  contextSubText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#8f939b]",
  contextCopyButton:
    "grid size-8 place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] text-[#b9bcc4] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[#f7f7f7]",
  statusDot: "size-2.5 rounded-full bg-[#46d05a] shadow-[0_0_14px_rgba(70,208,90,0.48)]",
  chatBody:
    "grid min-h-0 grid-rows-[auto_minmax(90px,1fr)_auto] gap-2.5 overflow-hidden p-[13px]",
  mikaBody:
    "relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-3 overflow-hidden bg-[var(--misty-app-pane-bg,var(--misty-surface))] p-5",
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
  mikaDetailLabel: "text-xs capitalize",
  chatDetailValue:
    "m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  mikaDetailValue: "m-0 min-w-0 break-words",
  errorText: "m-0 text-[#b0b0b0]",
  log:
    "grid min-h-0 content-start overflow-auto pr-0.5",
  chatLog: "gap-2",
  mikaLog: "row-start-2 min-w-0 gap-2.5",
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
    "sticky top-0 z-[1] bg-[#151515] text-[11px] font-bold capitalize text-[#9f9f9f]",
  planTableHeaderCell:
    "border-b border-[#2f2f2f] px-3 py-2",
  planTableRow:
    "align-top text-[#d4d4d4] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))]",
  planTableCell:
    "border-b border-[#242424] px-3 py-2.5 last:border-b-[#242424]",
  planTableOperation: "font-bold capitalize text-[#f0f0f0]",
  planTablePath: "min-w-0 break-words leading-normal text-[#d2d2d2]",
  planTableReason: "min-w-0 break-words leading-normal text-[#9f9f9f]",
  planWarningText: "m-0 text-xs leading-normal text-[#f0b3b3]",
  reviewLayer:
    "fixed inset-0 z-[2147482600] grid place-items-center bg-[rgba(0,0,0,0.66)] p-8 text-[#e2e2e2] backdrop-blur-[10px]",
  reviewPanel:
    "grid h-[min(820px,calc(100vh-64px))] w-[min(1120px,calc(100vw-64px))] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-[#242529] bg-[#07090b] shadow-[0_28px_90px_rgba(0,0,0,0.62)]",
  reviewHeader:
    "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-[#242529] px-5 py-4",
  reviewTitle: "m-0 text-[18px] font-semibold leading-tight text-[#f4f4f4]",
  reviewSubtitle: "m-0 mt-1 min-w-0 break-words text-sm leading-normal text-[#9f9f9f]",
  reviewBody: "grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden p-5",
  reviewSummaryGrid: "grid gap-3 md:grid-cols-2",
  reviewSummaryBlock:
    "grid gap-1 rounded-lg border border-[#242529] bg-[#0d0f12] px-3.5 py-3",
  reviewSummaryLabel:
    "text-[11px] font-bold capitalize text-[#8f8f8f]",
  reviewSummaryText:
    "m-0 min-w-0 break-words text-sm leading-normal text-[#d7d7d7]",
  reviewFooter:
    "flex flex-wrap items-center justify-between gap-3 border-t border-[#242529] px-5 py-4",
  reviewFooterActions: "flex flex-wrap justify-end gap-2",
  modeSelect:
    "h-10 rounded-lg border border-[#3f3f3f] bg-[#171717] px-3 py-0 text-[#f7f7f7] outline-none",
  messageTitle: "text-xs text-[#f7f7f7]",
  messageText:
    "m-0 whitespace-pre-wrap break-words font-[inherit] leading-normal text-[#d4d4d4]",
  composer:
    "grid border-t border-[#292929]",
  chatComposer: "gap-[9px] pt-2.5",
  mikaComposer: "row-start-3 gap-2.5 pt-3",
  textarea:
    "min-w-0 resize-y rounded-xl border border-[#343840] bg-[rgba(7,8,10,0.92)] px-3.5 py-3 font-[inherit] leading-snug text-[#f7f7f7] outline-none placeholder:text-[#777b84] focus:border-[#6a707c] focus:shadow-[0_0_0_3px_rgba(122,129,143,0.16)] disabled:text-[#898989]",
  composerActions: "flex justify-end gap-2",
  mikaComposerActions: "items-center gap-2 pt-0.5",
  composerButton:
    "min-h-8 rounded-lg border border-[#3f3f3f] bg-[#252525] px-3 font-semibold text-[#f7f7f7] hover:not-disabled:bg-[#303030] disabled:opacity-55",
  mikaComposerButton: "inline-flex h-10 min-h-0 items-center justify-center gap-2 rounded-xl px-3",
  mikaPrimaryButton:
    "border-[#ececec] bg-[#e8e8e8] text-[#242424] hover:not-disabled:bg-[#f5f5f5]",
  mikaFooter:
    "row-start-4 flex min-h-10 items-center justify-center gap-2 border-t border-[#24262a] pt-3 text-xs font-semibold text-[#777b84]",
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
              <MikaDelegatedRunAction message={message} />
              {message.citations?.length ? <AgentSources citations={message.citations} compact /> : null}
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
  surface?: "explorer" | "bot" | "bot-window" | "bot-chat-window";
  onHeaderDragStart?: () => void;
  onClose?: () => void;
  workingDirectory?: string;
  selectedPaths?: string[];
}) {
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const mikaAnimationSource = runtimeAssetSource(assetsDir, "animations/mika.webp", mikaAnimation);
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
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [mikaPeek, setMikaPeek] = useState(() => randomMikaPeek());
  const logRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef<HTMLDivElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
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

  useEffect(() => {
    if (!modeMenuOpen) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && modeMenuRef.current?.contains(target)) return;
      setModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModeMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    if (props.surface !== "bot-chat-window") return;
    let timer = 0;
    let disposed = false;

    const scheduleRetreat = () => {
      timer = window.setTimeout(() => {
        setMikaPeek((peek) => ({ ...peek, popped: false }));
        timer = window.setTimeout(() => {
          if (disposed) return;
          setMikaPeek(randomMikaPeek());
          scheduleRetreat();
        }, randomInteger(700, 1_500));
      }, randomInteger(3_500, 7_500));
    };

    scheduleRetreat();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [props.surface]);

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea || props.surface !== "bot-chat-window") return;
    const maximumHeight = 200;
    const minimumHeight = 60;
    textarea.style.height = "0px";
    const contentHeight = textarea.scrollHeight;
    textarea.style.height = `${Math.min(maximumHeight, Math.max(minimumHeight, contentHeight))}px`;
    textarea.style.overflowY = contentHeight > maximumHeight ? "auto" : "hidden";
  }, [prompt, props.surface]);

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
    <aside className={props.surface === "bot-chat-window" ? assistantPanelStyles.mikaChatWindowPanel : props.surface === "bot-window" ? assistantPanelStyles.mikaBotWindowPanel : props.surface === "bot" ? assistantPanelStyles.mikaBotPanel : assistantPanelStyles.mikaPanel} aria-label="Mika Assistant">
      <header className={cx(
        assistantPanelStyles.header,
        assistantPanelStyles.mikaHeader,
        assistantPanelStyles.mikaPanelHeader,
        props.surface === "bot-chat-window" && "cursor-grab active:cursor-grabbing [&_button]:cursor-pointer",
      )} onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest("button, input, textarea, select, [role='button']")) return;
        props.onHeaderDragStart?.();
      }}>
        <span className={cx(assistantPanelStyles.headerTitle, assistantPanelStyles.mikaHeaderTitle)}>
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
            props.surface === "bot-chat-window" ? null : <MikaEmptyState />
          ) : messages.map((message) => (
            <article key={message.id} className={assistantMessageClass(message.role, "mika")}>
              <strong className={assistantPanelStyles.messageTitle}>{message.role === "user" ? "You" : message.role === "tool" ? "Tool" : message.role === "error" ? "Error" : "Mika"}</strong>
              <pre className={assistantPanelStyles.messageText}>{message.text || (message.role === "assistant" && running ? "Thinking..." : "")}</pre>
              <MikaDelegatedRunAction message={message} />
              {message.citations?.length ? <AgentSources citations={message.citations} compact /> : null}
              {message.creditsUsed !== undefined ? <small className="text-[10px] text-[#858993]">{message.creditsUsed} credits · {message.creditsRemaining?.toLocaleString() ?? 0} remaining</small> : null}
              {message.toolRequestId ? <AssistantToolActions requestId={message.toolRequestId} approvals={toolApprovals} onApprove={approveToolRequest} /> : null}
              {message.planId ? <AssistantPlanActions planId={message.planId} plans={plans} onApply={approvePlan} /> : null}
            </article>
          ))}
        </div>
        <form
          className={cx(
            assistantPanelStyles.composer,
            assistantPanelStyles.mikaComposer,
            props.surface === "bot-chat-window" && "relative z-10 !border-t-0 !pt-0",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          {props.surface === "bot-chat-window" ? (
            <img
              alt=""
              aria-hidden="true"
              className={`pointer-events-none absolute -top-12 z-0 h-[72px] w-[88px] select-none object-contain drop-shadow-[0_10px_18px_rgba(18,92,150,0.24)] transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none ${mikaPeek.popped ? "opacity-100" : "opacity-0"}`}
              draggable={false}
              src={mikaAnimationSource}
              onError={(event) => restoreBundledAssetOnError(event, mikaAnimation)}
              style={{
                left: `${mikaPeek.leftPercent}%`,
                transform: mikaPeek.popped
                  ? `translateX(-50%) translateY(0) scale(1) rotate(${mikaPeek.tiltDegrees}deg)`
                  : `translateX(-50%) translateY(42px) scale(0.82) rotate(${mikaPeek.tiltDegrees}deg)`,
              }}
            />
          ) : null}
          <div className={props.surface === "bot-chat-window" ? "relative z-10 min-w-0 rounded-[24px] border border-white/10 bg-[#2a2a2a] shadow-[0_1px_0_rgba(255,255,255,0.035)_inset]" : "contents"}>
            <textarea
              className={cx(
                assistantPanelStyles.textarea,
                props.surface === "bot-chat-window" && "!w-full !min-h-[60px] !max-h-[200px] !resize-none !rounded-none !border-0 !bg-transparent !px-4 !pb-2 !pt-3.5 !shadow-none focus:!shadow-none",
              )}
              ref={promptRef}
              value={prompt}
              rows={props.surface === "bot-chat-window" ? 1 : 3}
              placeholder={assistantPlaceholder(configured, "Ask Mika to organize this folder...")}
              disabled={!configured || running}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter"
                  && !event.shiftKey
                  && !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submitPrompt();
                }
              }}
            />
            {props.surface === "bot-chat-window" ? (
              <div className="relative z-10 flex h-[52px] min-w-0 items-center justify-between gap-3 px-3 pb-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <button aria-label="Add context" className="grid size-9 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-[#e7e7e7] transition hover:bg-white/[0.07] disabled:opacity-60" disabled title="Attachments coming soon" type="button">
                    <Plus size={20} />
                  </button>
                  <div className="relative" ref={modeMenuRef}>
                    <button
                      aria-label="Mika permissions"
                      aria-expanded={modeMenuOpen}
                      aria-haspopup="menu"
                      className={`inline-flex h-9 min-w-[128px] items-center gap-2 rounded-xl border-0 bg-transparent px-2.5 text-sm font-semibold transition hover:bg-white/[0.06] ${mode === "auto" ? "text-[#f87171]" : "text-[#e7e7e7]"}`}
                      onClick={() => setModeMenuOpen((open) => !open)}
                      type="button"
                    >
                      <ShieldAlert className="shrink-0" size={17} />
                      <span className="min-w-0 flex-1 truncate text-left">{mode === "auto" ? "Full access" : "Ask first"}</span>
                      <ChevronDown className={`shrink-0 transition-transform ${modeMenuOpen ? "rotate-180" : ""}`} size={15} />
                    </button>
                    {modeMenuOpen ? (
                      <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 grid w-40 gap-1 rounded-xl border border-white/10 bg-[#171717] p-1.5 text-sm shadow-[0_14px_36px_rgba(0,0,0,0.5)]" role="menu">
                        {(["ask", "auto"] as const).map((option) => (
                          <button
                            aria-checked={mode === option}
                            className={`rounded-lg border-0 px-3 py-2 text-left font-semibold transition hover:bg-white/[0.08] ${mode === option ? "bg-white/[0.07]" : "bg-transparent"} ${option === "auto" ? "text-[#f87171]" : "text-[#e7e7e7]"}`}
                            key={option}
                            onClick={() => {
                              setMode(option);
                              setModeMenuOpen(false);
                            }}
                            role="menuitemradio"
                            type="button"
                          >
                            {option === "auto" ? "Full access" : "Ask first"}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="max-w-28 truncate px-1 text-sm font-medium text-[#ededed]" title={status?.modelName}>
                    {status?.modelName ?? "Mika"}
                  </span>
                  <button aria-label="Voice input" className="grid size-9 place-items-center rounded-full border-0 bg-transparent p-0 text-[#ededed] transition hover:bg-white/[0.07] disabled:opacity-60" disabled title="Voice input coming soon" type="button">
                    <Mic size={18} />
                  </button>
                  {running ? (
                    <button aria-label="Stop Mika" className="grid size-10 place-items-center rounded-full border border-white/10 bg-[#d5d5d5] p-0 text-[#262626] transition hover:bg-white" type="button" title="Cancel the active Mika request" onClick={abortPrompt}>
                      <X size={18} />
                    </button>
                  ) : (
                    <button aria-label="Send to Mika" className="grid size-10 place-items-center rounded-full border border-white/10 bg-[#d5d5d5] p-0 text-[#262626] transition hover:bg-white disabled:bg-[#777a7f] disabled:text-[#bfc1c4] disabled:opacity-100" type="submit" disabled={!configured || !prompt.trim()}>
                      <ArrowUp size={20} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
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
            )}
          </div>
        </form>
        {props.surface === "bot-chat-window" ? null : (
          <footer className={assistantPanelStyles.mikaFooter}>
            <Sparkles size={15} />
            Mika can make mistakes. Review file plans before applying them.
          </footer>
        )}
      </div>
    </aside>
  );
});

export function SmartLibraryDialog(props: { workingDirectory: string; onClose: () => void }) {
  const {
    loaded, phase, library, progress, estimate, reindexPlan, reindexProcessed, error,
    load, chooseFolder, rescan, trySample, analyzeFolder, refreshProgress, checkIndexUpgrade, upgradeIndex, removeLibrary,
  } = useSmartLibraryStore(useShallow((state) => ({
    loaded: state.loaded,
    phase: state.phase,
    library: state.library,
    progress: state.progress,
    estimate: state.estimate,
    reindexPlan: state.reindexPlan,
    reindexProcessed: state.reindexProcessed,
    error: state.error,
    load: state.load,
    chooseFolder: state.chooseFolder,
    rescan: state.rescan,
    trySample: state.trySample,
    analyzeFolder: state.analyzeFolder,
    refreshProgress: state.refreshProgress,
    checkIndexUpgrade: state.checkIndexUpgrade,
    upgradeIndex: state.upgradeIndex,
    removeLibrary: state.removeLibrary,
  })));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFullAnalysis, setConfirmFullAnalysis] = useState(false);
  const [confirmIndexUpgrade, setConfirmIndexUpgrade] = useState(false);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props.onClose]);

  const chooseLocalFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose one Mika Library folder" });
    if (typeof selected === "string") await chooseFolder(selected);
  };
  const analyzedAssets = library?.assets.filter((asset) => asset.status === "analyzed") ?? [];
  const failedAssets = library?.assets.filter((asset) => asset.status === "failed") ?? [];
  const indexStatus = progress?.indexStatus ?? progress?.reindexStatus;
  const busy = phase === "scanning" || phase === "uploading" || phase === "processing" || phase === "reindexing";

  return createPortal(
    <div className="fixed inset-0 z-[2147482700] grid place-items-center bg-black/75 p-6 text-[#eceef2] backdrop-blur-xl" onPointerDown={(event) => {
      if (event.target === event.currentTarget && !busy) props.onClose();
    }}>
      <section className="grid h-[min(860px,calc(100vh-48px))] w-[min(1180px,calc(100vw-48px))] min-h-0 grid-rows-[76px_minmax(0,1fr)] overflow-hidden rounded-[24px] border border-white/10 bg-[#090b0e] shadow-[0_38px_120px_rgba(0,0,0,0.72)]" role="dialog" aria-modal="true" aria-labelledby="smart-library-title">
        <header className="flex min-w-0 items-center justify-between gap-5 border-b border-white/10 px-7">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,#6d5dfc,#2d8cff)] text-white shadow-[0_12px_30px_rgba(69,104,255,0.28)]"><Images size={22} /></span>
            <div className="min-w-0">
              <h2 className="m-0 text-xl font-bold tracking-[-0.02em]" id="smart-library-title">Mika Library</h2>
              <p className="m-0 mt-1 truncate text-sm text-[#9298a3]">Scan, review, and manage semantic metadata for Explorer search.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {library ? <span className="hidden max-w-72 truncate rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-[#b8bdc7] md:block" title={library.rootPath}>{library.displayName} · {library.sourceKind === "cloud" ? "Cloud" : "Local"}</span> : null}
            <button className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-[#bec3cc] hover:bg-white/[0.08] hover:text-white" type="button" aria-label="Close Library" disabled={busy} onClick={props.onClose}><X size={19} /></button>
          </div>
        </header>
        <div className="min-h-0 overflow-auto">
          {!loaded || phase === "scanning" ? (
            <SmartLibraryBusy icon={<FolderSearch size={26} />} title={loaded ? "Scanning this folder" : "Loading your Library"} text={loaded ? "Reading filenames, formats, dates, and fingerprints locally. This does not use AI credits." : "Opening the private device catalog…"} />
          ) : !library ? (
            <div className="grid min-h-full place-items-center p-8">
              <div className="grid w-full max-w-3xl justify-items-center gap-7 text-center">
                <div className="grid size-24 place-items-center rounded-[30px] border border-[#44506b] bg-[radial-gradient(circle_at_30%_20%,#293a68,#11151f_72%)] text-[#99b8ff] shadow-[0_26px_70px_rgba(32,67,145,0.24)]"><Sparkles size={38} /></div>
                <div className="grid gap-3">
                  <h3 className="m-0 text-[32px] font-bold tracking-[-0.035em]">Understand your files, not just their folders.</h3>
                  <p className="m-0 mx-auto max-w-2xl text-base leading-relaxed text-[#9aa0aa]">Mika first scans one folder for free, then analyzes a representative 25-file sample. Originals stay where they are; organization is virtual and reversible.</p>
                </div>
                <div className="grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-3">
                  <SmartLibraryFeature icon={<Search size={18} />} title="Natural search" text="Find files by subjects, visible text, and extracted content." />
                  <SmartLibraryFeature icon={<Images size={18} />} title="Collections" text="Review AI organization before scaling." />
                  <SmartLibraryFeature icon={<ShieldAlert size={18} />} title="Private analysis" text="Paths and originals stay on device." />
                </div>
                {error ? <SmartLibraryError text={error} /> : null}
                <div className="flex flex-wrap justify-center gap-3">
                  {props.workingDirectory ? <button className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#edf1f8] px-5 font-bold text-[#15181d] hover:bg-white" type="button" onClick={() => void chooseFolder(props.workingDirectory)}><Folder size={18} />Use Current Folder</button> : null}
                  <button className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-5 font-bold text-white hover:bg-white/[0.09]" type="button" onClick={() => void chooseLocalFolder()}><HardDrive size={18} />Choose Local Folder</button>
                </div>
                <span className="text-xs font-medium text-[#6f7681]">Connected-cloud folders can be selected by opening them in Files and choosing Use Current Folder.</span>
              </div>
            </div>
          ) : (
            <div className="grid min-h-full grid-rows-[auto_minmax(0,1fr)]">
              <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[rgba(9,11,14,0.94)] px-6 py-4 backdrop-blur-xl">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-[#c3c8d1]">{library.sourceKind === "cloud" ? <Cloud size={14} /> : <HardDrive size={14} />}{library.preflight.totalImages.toLocaleString()} files</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-[#c3c8d1]">{analyzedAssets.length.toLocaleString()} analyzed</span>
                </div>
                <div className="flex items-center gap-2">
                  <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-bold text-[#cbd0d8] hover:bg-white/[0.08]" type="button" disabled={busy} onClick={() => void rescan()}><RefreshCw size={14} />Rescan</button>
                  {confirmDelete ? (
                    <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#a9363d] px-3 text-xs font-bold text-white hover:bg-[#bd4149]" type="button" onClick={() => void removeLibrary()}><Check size={14} />Remove now</button>
                  ) : (
                    <button className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-[#aeb4be] hover:bg-[#3b1d22] hover:text-[#ff9da5]" type="button" aria-label="Remove Library" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>
                  )}
                </div>
              </div>
              <div className="min-h-0 p-6">
                {error ? <div className="mb-4"><SmartLibraryError text={error} /></div> : null}
                {phase === "uploading" ? (
                  <SmartLibraryBusy icon={<Cloud size={26} />} title="Preparing private analysis" text="Misty sends EXIF-stripped thumbnails for visuals or bounded extracted text and metadata for other files, in batches of eight. Paths and originals remain on your device." />
                ) : phase === "reindexing" ? (
                  <SmartLibraryBusy icon={<RefreshCw size={26} />} title="Improving metadata and search" text={`${reindexProcessed.toLocaleString()} assets securely refreshed. Misty repairs sparse legacy descriptions and rebuilds the semantic index from path-free previews or extracted metadata.`} />
                ) : phase === "processing" ? (
                  <SmartLibraryProgressView progress={progress} onRefresh={refreshProgress} />
                ) : analyzedAssets.length > 0 ? (
                  <div className="grid gap-6">
                    <section className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                      <div className="flex flex-wrap items-end justify-between gap-4">
                        <div><h3 className="m-0 text-xl font-bold">Sample review</h3><p className="m-0 mt-1 text-sm text-[#8f96a1]">Review descriptions, tags, confidence, and virtual collections before analyzing more.</p></div>
                        <div className="flex flex-wrap gap-2">
                          {indexStatus?.upgradeNeeded ? <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#65552d] bg-[#211b0d] px-4 text-sm font-bold text-[#f2dc9c] hover:bg-[#2b240f]" type="button" onClick={() => { void checkIndexUpgrade().then(() => setConfirmIndexUpgrade(true)); }}><RefreshCw size={15} />Improve Metadata &amp; Index</button> : indexStatus ? <span className="inline-flex h-10 items-center rounded-xl border border-[#28523e] bg-[#10251c] px-3 text-xs font-bold text-[#8fe0af]">Semantic index v{indexStatus.currentVersion} current</span> : null}
                          {library.preflight.eligibleImages > 0 ? <button className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#edf1f8] px-4 text-sm font-bold text-[#15181d] hover:bg-white" type="button" onClick={() => setConfirmFullAnalysis(true)}><Sparkles size={16} />Analyze This Folder</button> : null}
                        </div>
                      </div>
                      {confirmFullAnalysis ? <div className="grid gap-3 rounded-xl border border-[#65552d] bg-[#211b0d] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><strong className="block text-sm text-[#f2dc9c]">Approve the remaining folder analysis?</strong><span className="mt-1 block text-xs leading-relaxed text-[#c5b98f]">{formatEstimate(estimate ?? library.preflight.estimate)} Only successfully analyzed files are charged; this does not move or rename anything.</span></div><div className="flex gap-2"><button className="h-9 rounded-lg border border-white/10 px-3 text-xs font-bold" type="button" onClick={() => setConfirmFullAnalysis(false)}>Cancel</button><button className="h-9 rounded-lg bg-[#edf1f8] px-3 text-xs font-bold text-[#15181d]" type="button" onClick={() => { setConfirmFullAnalysis(false); void analyzeFolder(); }}>Approve Analysis</button></div></div> : null}
                      {confirmIndexUpgrade ? <div className="grid gap-3 rounded-xl border border-[#384a73] bg-[#111827] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><strong className="block text-sm text-[#c7d7ff]">Approve metadata and search improvements?</strong><span className="mt-1 block text-xs leading-relaxed text-[#9eb0d6]">{indexStatus?.outdatedAssets ?? reindexPlan?.assets.length ?? 0} assets need index v{reindexPlan?.targetVersion ?? "latest"}. Misty will regenerate sparse legacy labels when necessary, then rebuild embeddings with {reindexPlan?.embeddingModel ?? indexStatus?.embeddingModel ?? "the configured embedding model"}. This may resend private path-free previews and uses a small amount of Mika AI processing. It never runs automatically.</span></div><div className="flex gap-2"><button className="h-9 rounded-lg border border-white/10 px-3 text-xs font-bold" type="button" onClick={() => setConfirmIndexUpgrade(false)}>Cancel</button><button className="h-9 rounded-lg bg-[#edf1f8] px-3 text-xs font-bold text-[#15181d]" type="button" disabled={!reindexPlan} onClick={() => { setConfirmIndexUpgrade(false); void upgradeIndex(); }}>Approve Improvements</button></div></div> : null}
                      <div className="flex items-start gap-3 rounded-xl border border-[#384a73] bg-[#111827] px-4 py-3 text-sm text-[#b7caff]">
                        <Search className="mt-0.5 shrink-0" size={17} />
                        <span>Metadata is ready. Search for these files from Explorer’s centered <strong>Spotlight search</strong>.</span>
                      </div>
                    </section>
                    <SmartLibraryAssetGrid assets={analyzedAssets} library={library} />
                    {failedAssets.length > 0 ? <p className="m-0 text-sm text-[#e9a0a7]">{failedAssets.length} file{failedAssets.length === 1 ? "" : "s"} failed. Mika does not charge for failed analysis or infrastructure retries.</p> : null}
                  </div>
                ) : (
                  <SmartLibraryPreflightView library={library} estimate={estimate} onTrySample={trySample} />
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function SmartLibraryFeature(props: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-4"><span className="text-[#91adff]">{props.icon}</span><strong className="text-sm">{props.title}</strong><span className="text-xs leading-relaxed text-[#858c97]">{props.text}</span></div>;
}

function SmartLibraryBusy(props: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="grid min-h-full place-items-center p-8"><div className="grid max-w-lg justify-items-center gap-4 text-center"><span className="grid size-16 animate-pulse place-items-center rounded-2xl border border-[#435275] bg-[#172038] text-[#9bb8ff]">{props.icon}</span><h3 className="m-0 text-2xl font-bold">{props.title}</h3><p className="m-0 text-sm leading-relaxed text-[#9299a4]">{props.text}</p></div></div>;
}

function SmartLibraryError(props: { text: string }) {
  return <div className="flex items-start gap-3 rounded-xl border border-[#663139] bg-[#261217] px-4 py-3 text-left text-sm text-[#f2b2b8]"><AlertCircle className="mt-0.5 shrink-0" size={17} /><span>{props.text}</span></div>;
}

function SmartLibraryPreflightView(props: { library: ReturnType<typeof useSmartLibraryStore.getState>["library"] & {}; estimate: ReturnType<typeof useSmartLibraryStore.getState>["estimate"]; onTrySample: () => Promise<void> }) {
  const { preflight } = props.library;
  return <div className="grid gap-6">
    <div><h3 className="m-0 text-2xl font-bold tracking-[-0.025em]">Ready to try a sample</h3><p className="m-0 mt-2 text-sm text-[#9299a4]">The scan was local and free. Mika will analyze a representative sample before asking to continue.</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <SmartLibraryMetric label="Discovered" value={preflight.totalImages} />
      <SmartLibraryMetric label="Supported" value={preflight.supportedImages} tone="good" />
      <SmartLibraryMetric label="Unsupported" value={preflight.unsupportedImages} tone={preflight.unsupportedImages ? "warn" : undefined} />
      <SmartLibraryMetric label="New / changed" value={preflight.newImages + preflight.changedImages} />
      <SmartLibraryMetric label="Pilot eligible" value={preflight.pilotCappedImages} suffix="max 500" />
    </div>
    {preflight.skippedFullOriginalImages > 0 ? <SmartLibraryError text={`${preflight.skippedFullOriginalImages} cloud files were skipped because their provider would require downloading the full original. This pilot uploads previews or extracted metadata only.`} /> : null}
    <div className="grid gap-4 rounded-2xl border border-[#384a73] bg-[linear-gradient(145deg,rgba(31,45,78,.72),rgba(16,21,33,.72))] p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid gap-2"><span className="text-xs font-bold capitalize text-[#91adff]">25-File Trial Allowance</span><strong className="text-lg">Try the sample before spending credits</strong><span className="text-sm leading-relaxed text-[#a7afbd]">{preflight.sampleAssetIds.length} files selected across subfolders, formats, and dates. {formatEstimate(props.estimate ?? preflight.estimate)}</span></div>
      <button className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#edf1f8] px-5 font-bold text-[#15181d] hover:bg-white disabled:opacity-50" type="button" disabled={preflight.sampleAssetIds.length === 0} onClick={() => void props.onTrySample()}><Sparkles size={18} />Try Sample</button>
    </div>
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm leading-relaxed text-[#8f96a1]"><ShieldAlert className="mt-0.5 shrink-0 text-[#a9bfff]" size={18} /><span>Misty sends opaque asset IDs plus EXIF-stripped 384–512px previews for visual files, or bounded extracted text and metadata for other supported files. Paths and originals remain in the device catalog. Analysis and index upgrades always require approval.</span></div>
  </div>;
}

function SmartLibraryMetric(props: { label: string; value: number; suffix?: string; tone?: "good" | "warn" }) {
  return <div className="grid gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="text-xs font-bold text-[#858d99]">{props.label}</span><strong className={`text-2xl ${props.tone === "good" ? "text-[#8fe0af]" : props.tone === "warn" ? "text-[#f0bd72]" : "text-white"}`}>{props.value.toLocaleString()}</strong>{props.suffix ? <span className="text-[11px] text-[#747c87]">{props.suffix}</span> : null}</div>;
}

function SmartLibraryProgressView(props: { progress: ReturnType<typeof useSmartLibraryStore.getState>["progress"]; onRefresh: () => Promise<void> }) {
  const completed = props.progress?.successfulImages ?? 0;
  const failed = props.progress?.failedImages ?? 0;
  const queued = props.progress?.queuedImages ?? 0;
  const total = Math.max(1, completed + failed + queued);
  const percent = Math.round(((completed + failed) / total) * 100);
  return <div className="grid min-h-[500px] place-items-center"><div className="grid w-full max-w-2xl gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6"><div className="flex items-center justify-between"><div><h3 className="m-0 text-xl font-bold">Mika is understanding your files</h3><p className="m-0 mt-1 text-sm text-[#8f96a1]">Keep Misty open while the existing Mika server processes each bounded batch.</p></div><span className="text-2xl font-bold">{percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[linear-gradient(90deg,#6d5dfc,#2d9cff)] transition-[width]" style={{ width: `${percent}%` }} /></div><div className="grid grid-cols-3 gap-3"><SmartLibraryMetric label="Completed" value={completed} tone="good" /><SmartLibraryMetric label="Remaining" value={queued} /><SmartLibraryMetric label="Failed" value={failed} tone={failed ? "warn" : undefined} /></div><button className="inline-flex h-10 items-center justify-center gap-2 justify-self-end rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm font-bold hover:bg-white/[0.09]" type="button" onClick={() => void props.onRefresh()}><RefreshCw size={15} />Refresh now</button></div></div>;
}

function SmartLibraryAssetGrid(props: { assets: SmartLibraryAsset[]; library: NonNullable<ReturnType<typeof useSmartLibraryStore.getState>["library"]> }) {
  if (props.assets.length === 0) return <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-white/10 text-sm text-[#7f8792]">No analyzed files are available for review.</div>;
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{props.assets.map((asset) => <SmartLibraryAssetCard key={asset.assetId} asset={asset} library={props.library} />)}</div>;
}

function SmartLibraryAssetCard(props: { asset: SmartLibraryAsset; library: NonNullable<ReturnType<typeof useSmartLibraryStore.getState>["library"]> }) {
  const visual = props.asset.assetKind === "image" || props.asset.mimeType.startsWith("image/");
  const source = visual && props.asset.sourceKind === "local" ? safeTauriAssetUrl(joinDevicePath(props.library.rootPath, props.asset.relativePath)) : null;
  const confidence = props.asset.confidence === null ? null : Math.round(props.asset.confidence * 100);
  return <article className="grid min-w-0 grid-rows-[190px_auto] overflow-hidden rounded-2xl border border-white/10 bg-[#101318] shadow-[0_10px_30px_rgba(0,0,0,.2)]">
    <div className="relative overflow-hidden bg-[radial-gradient(circle_at_30%_20%,#29334a,#11141a)]">{source ? <img className="size-full object-cover" alt="" src={source} /> : <span className="grid size-full place-items-center gap-2 text-[#71809e]">{visual && props.asset.sourceKind === "cloud" ? <Cloud size={36} /> : <File size={36} />}<small className="font-bold capitalize">{props.asset.assetKind || props.asset.extension.replace(/^\./, "") || "file"}</small></span>}{confidence !== null ? <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-bold backdrop-blur">{confidence}% confidence</span> : null}</div>
    <div className="grid gap-3 p-4"><div className="min-w-0"><strong className="block truncate text-sm" title={props.asset.relativePath}>{props.asset.name}</strong><span className="mt-1 block line-clamp-3 text-xs leading-relaxed text-[#a0a7b2]">{props.asset.description || "No description generated."}</span></div>{props.asset.tags.length > 0 ? <div className="flex flex-wrap gap-1.5">{props.asset.tags.slice(0, 6).map((tag) => <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-[#b9c0ca]" key={tag}>{tag}</span>)}</div> : null}{props.asset.collections.length > 0 ? <div className="flex items-center gap-2 text-[11px] font-bold text-[#91adff]"><Images size={13} /><span className="truncate">{props.asset.collections.join(" · ")}</span></div> : null}</div>
  </article>;
}

function joinDevicePath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/^[\\/]+/, "")}`;
}

function formatEstimate(estimate: ReturnType<typeof useSmartLibraryStore.getState>["estimate"]): string {
  if (!estimate) return "Final credits and price will be confirmed before upload.";
  const price = estimate.priceMinor !== null && estimate.currency
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: estimate.currency }).format(estimate.priceMinor / 100)
    : "price confirmed by your plan";
  return `${estimate.includedImages} included · ${estimate.billableImages} billable Mika credits · ${price}.`;
}

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

function planOperationGroup(operation: AssistantPlanOperation): string {
  const destination = planOperationDestination(operation).replace(/[\\/]+$/, "");
  const separator = Math.max(destination.lastIndexOf("/"), destination.lastIndexOf("\\"));
  if (operation.type === "mkdir") return destination;
  return separator > 0 ? destination.slice(0, separator) : "Destination";
}

function planOperationPreview(operation: AssistantPlanOperation): string | null {
  if (operation.type === "mkdir") return null;
  const extension = operation.from.split(".").pop()?.toLowerCase() ?? "";
  return ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif"].includes(extension)
    ? safeTauriAssetUrl(operation.from)
    : null;
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
  const groupedOperations = useMemo(() => {
    const groups = new Map<string, AssistantPlanOperation[]>();
    for (const operation of props.plan.plan.operations) {
      const group = planOperationGroup(operation);
      groups.set(group, [...(groups.get(group) ?? []), operation]);
    }
    return [...groups.entries()];
  }, [props.plan.plan.operations]);

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
          <div className="grid min-h-0 gap-4 overflow-auto pr-1">
            {groupedOperations.map(([destination, operations]) => (
              <section className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4" key={destination}>
                <header className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <div className="flex min-w-0 items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#1c2433] text-[#9eb8f5]"><Folder size={16} /></span><div className="min-w-0"><span className="block text-[10px] font-bold capitalize text-[#7f8792]">Destination Group</span><strong className="block truncate text-sm text-[#edf0f5]" title={destination}>{destination}</strong></div></div>
                  <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-bold text-[#abb2bd]">{operations.length} item{operations.length === 1 ? "" : "s"}</span>
                </header>
                <div className="grid gap-3">
                  {operations.map((operation, index) => {
                    const preview = planOperationPreview(operation);
                    const confidence = operation.type === "mkdir" ? null : operation.confidence;
                    return <article className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-4 rounded-xl border border-white/[0.07] bg-[#0c0f13] p-3" key={`${operation.type}-${index}-${planOperationDetail(operation)}`}>
                      <div className="grid size-16 place-items-center overflow-hidden rounded-xl bg-[#171b22] text-[#768092]">{preview ? <img alt="" className="size-full object-cover" src={preview} /> : operation.type === "mkdir" ? <Folder size={24} /> : <File size={23} />}</div>
                      <div className="grid min-w-0 gap-2.5">
                        <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-[#232a36] px-2 py-1 text-[10px] font-bold capitalize text-[#bdcae7]">{operation.type}</span>{typeof confidence === "number" ? <span className="text-[11px] font-semibold text-[#8e96a2]">{Math.round(confidence * 100)}% confidence</span> : null}</div>
                        {operation.type === "mkdir" ? <div><span className="block text-[10px] font-bold capitalize text-[#747c88]">Create Folder</span><span className="mt-1 block break-all text-xs leading-relaxed text-[#d6dae1]">{operation.path}</span></div> : <div className="grid gap-2 lg:grid-cols-2"><div className="min-w-0"><span className="block text-[10px] font-bold capitalize text-[#747c88]">From</span><span className="mt-1 block break-all text-xs leading-relaxed text-[#d6dae1]">{planOperationSource(operation)}</span></div><div className="min-w-0"><span className="block text-[10px] font-bold capitalize text-[#747c88]">To</span><span className="mt-1 block break-all text-xs leading-relaxed text-[#d6dae1]">{planOperationDestination(operation)}</span></div></div>}
                        <p className="m-0 text-xs leading-relaxed text-[#9098a4]"><span className="font-bold text-[#b7bdc7]">Why: </span>{operation.reason || "No reason provided."}</p>
                      </div>
                    </article>;
                  })}
                </div>
              </section>
            ))}
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

function randomMikaPeek(): { leftPercent: number; tiltDegrees: number; popped: boolean } {
  return {
    leftPercent: randomInteger(10, 90),
    tiltDegrees: randomInteger(-8, 8),
    popped: true,
  };
}

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
