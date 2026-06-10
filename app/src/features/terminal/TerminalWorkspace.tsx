import { dockLeaves, useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { SystemErrorActivity } from "@/features/activity";
import {
  detectShortcutPlatform,
  formatShortcutLabel,
  registerShortcutHandler,
  useEffectiveShortcut,
} from "@/features/shortcuts";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TerminalConnectionMenu } from "./TerminalConnectionMenu";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import type { TerminalSessionStatus } from "./TerminalPane";
import { TerminalSearchField, type TerminalSearchResult } from "./TerminalSearchField";
import {
  listSshEnvironments,
  localTerminalEnvironment,
  terminalEnvironmentIdentity,
  type SshEnvironment,
  type TerminalEnvironment,
} from "./sshEnvironments";
import {
  cwdBySlot,
  killTerminalSlot,
  killTerminalTab as killRegisteredTerminalTab,
  titleBySlot,
} from "./terminalRegistry";
import { hasTerminalControlCharacters } from "./terminalInputSafety";

/** One dock tab owns zero or one shell. This map keeps that identity stable
 * while the tab is inactive or its React surface is temporarily detached. */
const slotByTab = new Map<string, string | null>();
const environmentByTab = new Map<string, TerminalEnvironment>();
const EMPTY_SEARCH_RESULT: TerminalSearchResult = { resultIndex: -1, resultCount: 0 };

export function killTerminalTab(tabId: string): void {
  slotByTab.delete(tabId);
  environmentByTab.delete(tabId);
  killRegisteredTerminalTab(tabId);
}

function makeSlotId(): string {
  return `term-${crypto.randomUUID()}`;
}

export function TerminalWorkspace(props: { tab?: WorkspaceTab; active?: boolean }) {
  const fallbackTab = useWorkspaceStore((state) => {
    const leaves = dockLeaves(state.layout.root);
    const focused = leaves.find((leaf) => leaf.id === state.layout.focusedPaneId) ?? leaves[0];
    const active = focused?.tabs.find((tab) => tab.id === focused.activeTabId);
    return active?.surfaceId === "terminal" ? active : undefined;
  });
  const tab = props.tab ?? fallbackTab;
  const tabId = tab?.id ?? null;
  const active = props.active ?? true;
  const workspaceFocused = useWorkspaceStore((state) => {
    if (!tabId) return false;
    const pane = dockLeaves(state.layout.root).find(
      (candidate) => candidate.id === state.layout.focusedPaneId,
    );
    return pane?.activeTabId === tabId;
  });
  const renameWorkspaceTab = useWorkspaceStore((state) => state.renameTab);
  const [slotId, setSlotId] = useState<string | null>(() => {
    if (!tabId) return null;
    if (slotByTab.has(tabId)) return slotByTab.get(tabId) ?? null;
    const created = makeSlotId();
    slotByTab.set(tabId, created);
    return created;
  });
  const [title, setTitle] = useState(() => (slotId ? (titleBySlot.get(slotId) ?? "zsh") : ""));
  const [cwd, setCwd] = useState(() => (slotId ? (cwdBySlot.get(slotId) ?? "") : ""));
  const [environment, setEnvironment] = useState<TerminalEnvironment>(() =>
    tabId ? (environmentByTab.get(tabId) ?? localTerminalEnvironment) : localTerminalEnvironment,
  );
  const [sshEnvironments, setSshEnvironments] = useState<SshEnvironment[]>([]);
  const [environmentError, setEnvironmentError] = useState("");
  const [sessionStatus, setSessionStatus] = useState<TerminalSessionStatus>("starting");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<TerminalSearchResult>(EMPTY_SEARCH_RESULT);
  const paneRef = useRef<TerminalPaneHandle | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchBinding = useEffectiveShortcut("terminal.search");
  const searchShortcutLabel =
    formatShortcutLabel(searchBinding.primary, detectShortcutPlatform()) || "⌘F";

  useEffect(() => {
    if (!tabId) return;
    if (!slotByTab.has(tabId)) {
      const created = makeSlotId();
      slotByTab.set(tabId, created);
      setSlotId(created);
    } else setSlotId(slotByTab.get(tabId) ?? null);
  }, [tabId]);

  useEffect(() => {
    let active = true;
    void listSshEnvironments()
      .then((items) => {
        if (active) setSshEnvironments(items);
      })
      .catch(() => {
        if (active) setEnvironmentError("SSH hosts unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!tabId) return;
    const label = cwd ? `Terminal · ${basename(cwd)}` : title ? `Terminal · ${title}` : "Terminal";
    renameWorkspaceTab(tabId, label);
  }, [cwd, renameWorkspaceTab, tabId, title]);

  const clearTerminalSearch = useCallback((focusTerminal = false) => {
    setSearchQuery("");
    setSearchResult(EMPTY_SEARCH_RESULT);
    paneRef.current?.clearSearch();
    if (focusTerminal) paneRef.current?.focus();
  }, []);

  const searchTerminal = useCallback((query: string, direction: "next" | "previous" = "next") => {
    setSearchQuery(query);
    if (!query) {
      setSearchResult(EMPTY_SEARCH_RESULT);
      paneRef.current?.clearSearch();
      return;
    }
    paneRef.current?.search(query, direction);
  }, []);

  const chooseEnvironment = useCallback(
    (next: TerminalEnvironment) => {
      if (!tabId) return;
      if (terminalEnvironmentIdentity(next) === terminalEnvironmentIdentity(environment)) return;
      clearTerminalSearch();
      if (slotId) killTerminalSlot(slotId);
      const created = makeSlotId();
      slotByTab.set(tabId, created);
      environmentByTab.set(tabId, next);
      setEnvironment(next);
      setSlotId(created);
      setTitle(next.kind === "ssh" ? next.ssh.label : "zsh");
      setCwd("");
      setSessionStatus("starting");
    },
    [clearTerminalSearch, environment, slotId, tabId],
  );

  useEffect(() => {
    const enabled = () => {
      if (!tabId || !paneRef.current) return false;
      const workspace = useWorkspaceStore.getState();
      const pane = dockLeaves(workspace.layout.root).find(
        (candidate) => candidate.id === workspace.layout.focusedPaneId,
      );
      return pane?.activeTabId === tabId;
    };
    const actions: Record<string, () => void> = {
      "terminal.clear": () => paneRef.current?.clear(),
      "terminal.search": () => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      },
      "terminal.zoom_in": () => paneRef.current?.bumpFontScale(0.1),
      "terminal.zoom_out": () => paneRef.current?.bumpFontScale(-0.1),
      "terminal.zoom_reset": () => paneRef.current?.bumpFontScale("reset"),
      "terminal.copy": () => void paneRef.current?.copySelection(),
      "terminal.paste": () => void paneRef.current?.paste(),
    };
    const unregister = Object.entries(actions).map(([commandId, action]) =>
      registerShortcutHandler(commandId, action, enabled),
    );
    return () => unregister.forEach((remove) => remove());
  }, [tabId]);

  useEffect(() => {
    if (!slotId || !active || !workspaceFocused) return;
    const frame = requestAnimationFrame(() => paneRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active, slotId, workspaceFocused]);

  const aiAdapter = useMemo<AiSurfaceAdapter>(() => {
    const scopeId = slotId || tabId || "terminal";
    const stagedCommand = (artifact: AiArtifact) => {
      if (artifact.kind !== "terminal_command" || !slotId || sessionStatus !== "running") return "";
      const operations = artifact.operations as {
        terminal_scope_id?: string;
        commands?: Array<{ command?: string; destructive?: boolean }>;
      };
      if (operations.terminal_scope_id !== scopeId || operations.commands?.length !== 1) return "";
      const command = operations.commands[0]?.command;
      return typeof command === "string" &&
        command.length <= 8_000 &&
        !hasTerminalControlCharacters(command)
        ? command
        : "";
    };
    return {
      surfaceId: "terminal",
      label: title || "Terminal",
      getContext: () => [
        {
          kind: "terminal.session",
          id: scopeId,
          title: `${environment.kind === "ssh" ? "SSH" : "Local"} terminal${title ? ` · ${title}` : ""}`,
          privacy: "device",
          opaqueScopeId: slotId ?? undefined,
          metadata: { environment: environment.kind, status: sessionStatus },
        },
      ],
      getSelection: () => {
        const raw = paneRef.current?.aiSnapshot() ?? "";
        const content = redactTerminalSecrets(raw);
        return content
          ? {
              kind: "text",
              content,
              object: { kind: "terminal.session", id: scopeId },
              anchors: {
                source: raw.trim() === content.trim() ? "visible_buffer" : "redacted_buffer",
              },
              contentHash: terminalAiHash(content),
            }
          : null;
      },
      getSuggestedActions: () => [
        {
          id: "explain-output",
          label: "Explain output",
          prompt:
            "Explain the selected or recent terminal output and identify the likely cause of any failure.",
        },
        {
          id: "suggest-fix",
          label: "Suggest fix",
          prompt: "Suggest the safest next command or diagnostic step. Do not execute anything.",
        },
        {
          id: "stage-command",
          label: "Draft command",
          prompt:
            "Propose exactly one command for this terminal scope, with its exact effect and rollback. Do not execute it.",
          requestedArtifactKind: "terminal_command",
        },
        {
          id: "summarize-session",
          label: "Summarize session",
          prompt:
            "Summarize what happened in this visible terminal session and any unresolved issue.",
        },
        {
          id: "security-check",
          label: "Security check",
          prompt:
            "Review the visible command output for security risks or accidental secret exposure. Do not repeat secrets.",
        },
      ],
      canApply: (artifact) => Boolean(stagedCommand(artifact)),
      applyArtifact: async (artifact) => {
        const command = stagedCommand(artifact);
        if (!command || !paneRef.current) {
          throw new Error("The PTY scope changed. Ask Misty to regenerate this command.");
        }
        await paneRef.current.stageAiCommand(command);
      },
    };
  }, [environment.kind, sessionStatus, slotId, tabId, title]);
  useAiSurfaceAdapter(aiAdapter);
  if (!tabId) return <TerminalEmptyState />;

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#111312]">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-workspace px-2 text-[11px] text-cream-muted">
        {environmentError ? (
          <SystemErrorActivity
            error={environmentError}
            scope="terminal:environments"
            title="Terminal environments could not be loaded"
            target={{ kind: "route", href: "/terminal" }}
          />
        ) : null}
        <TerminalSearchField
          ref={searchInputRef}
          value={searchQuery}
          result={searchResult}
          shortcutLabel={searchShortcutLabel}
          disabled={!slotId}
          onChange={(query) => searchTerminal(query)}
          onNavigate={(direction) => searchTerminal(searchQuery, direction)}
          onDismiss={() => clearTerminalSearch(true)}
        />
        <span className="min-w-0 flex-1" aria-hidden="true" />
        <TerminalConnectionMenu
          environment={environment}
          environments={sshEnvironments}
          loadError={environmentError}
          disabled={!slotId}
          onSelect={chooseEnvironment}
        />
        {environmentError ? (
          <span id="terminal-environment-error" className="sr-only" role="status">
            {environmentError}
          </span>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">
        {slotId ? (
          <TerminalPane
            key={slotId}
            ref={paneRef}
            slotId={slotId}
            tabId={tabId}
            visible={active}
            focused={active && workspaceFocused}
            onTitleChange={setTitle}
            onCwdChange={setCwd}
            environment={environment}
            onSessionStatusChange={setSessionStatus}
            onSearchResultsChange={setSearchResult}
            onCancelSsh={() => chooseEnvironment(localTerminalEnvironment)}
          />
        ) : (
          <TerminalEmptyState />
        )}
      </div>
      <footer
        className="flex h-6 shrink-0 items-center border-t border-charcoal-border bg-charcoal-workspace px-3 font-mono text-[10px] text-cream-muted"
        aria-label="Terminal information"
      >
        <span>{environment.kind === "ssh" ? "ssh" : "zsh"}</span>
        <span className="mx-3 h-3 w-px bg-charcoal-border" aria-hidden="true" />
        <span>UTF-8</span>
      </footer>
    </section>
  );
}

function redactTerminalSecrets(value: string) {
  return value
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|secret|password)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

function terminalAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function TerminalEmptyState() {
  return (
    <div className="grid h-full place-items-center bg-[#111312] p-6">
      <div className="text-center">
        <SquareTerminal size={28} className="mx-auto mb-3 text-cream-muted" />
        <p className="text-sm text-cream-muted">No shell is available in this workspace.</p>
      </div>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
