import { dockLeaves, useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { SystemErrorActivity } from "@/features/activity";
import { registerShortcutHandler } from "@/features/shortcuts";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import type { TerminalSessionStatus } from "./TerminalPane";
import {
  listSshEnvironments,
  localTerminalEnvironment,
  sshEnvironmentSummary,
  type SshEnvironment,
  type TerminalEnvironment,
} from "./sshEnvironments";
import {
  cwdBySlot,
  killTerminalSlot,
  killTerminalTab as killRegisteredTerminalTab,
  titleBySlot,
  unregisterSlot,
} from "./terminalRegistry";
import { hasTerminalControlCharacters } from "./terminalInputSafety";

/** One dock tab owns zero or one shell. This map keeps that identity stable
 * while the tab is inactive or its React surface is temporarily detached. */
const slotByTab = new Map<string, string | null>();
const environmentByTab = new Map<string, TerminalEnvironment>();

export function killTerminalTab(tabId: string): void {
  slotByTab.delete(tabId);
  environmentByTab.delete(tabId);
  killRegisteredTerminalTab(tabId);
}

function makeSlotId(): string {
  return `term-${crypto.randomUUID()}`;
}

export function TerminalWorkspace(props: { tab?: WorkspaceTab }) {
  const fallbackTab = useWorkspaceStore((state) => {
    const leaves = dockLeaves(state.layout.root);
    const focused = leaves.find((leaf) => leaf.id === state.layout.focusedPaneId) ?? leaves[0];
    const active = focused?.tabs.find((tab) => tab.id === focused.activeTabId);
    return active?.surfaceId === "terminal" ? active : undefined;
  });
  const tab = props.tab ?? fallbackTab;
  const tabId = tab?.id ?? null;
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
  const paneRef = useRef<TerminalPaneHandle | null>(null);

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

  const closeShell = useCallback(() => {
    if (slotId) killTerminalSlot(slotId);
    if (tabId) {
      if (slotId) unregisterSlot(tabId, slotId);
      slotByTab.set(tabId, null);
    }
    setSlotId(null);
    setCwd("");
    setTitle("");
  }, [slotId, tabId]);

  const newShell = useCallback(() => {
    if (!tabId) return;
    const created = makeSlotId();
    slotByTab.set(tabId, created);
    setSlotId(created);
    setTitle("zsh");
    setCwd("");
  }, [tabId]);

  const chooseEnvironment = useCallback(
    (next: TerminalEnvironment) => {
      if (!tabId) return;
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
    [slotId, tabId],
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
      "terminal.search": () => paneRef.current?.toggleSearch(),
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
    if (!slotId) return;
    const frame = requestAnimationFrame(() => paneRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [slotId]);

  const displayCwd = useMemo(() => (cwd ? shortenHome(cwd) : ""), [cwd]);
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
  if (!tabId) return <TerminalEmptyState onNewShell={() => undefined} disabled />;

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
        <SquareTerminal size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono">
          {displayCwd || title || "Terminal"}
        </span>
        <span className="rounded bg-charcoal-card px-1.5 py-0.5 text-[10px] capitalize">
          {sessionStatus.replace(/_/g, " ")}
        </span>
        {environment.kind === "ssh" ? (
          <span className="hidden rounded bg-charcoal-card px-1.5 py-0.5 text-[10px] lg:inline">
            Agent tools · device-local
          </span>
        ) : null}
        <select
          aria-label="Terminal environment"
          className="h-6 max-w-52 rounded border border-charcoal-border bg-charcoal-card px-1.5 text-[10px] text-cream outline-none"
          value={environment.kind === "ssh" ? `ssh:${environment.ssh.id}` : "local"}
          title="Terminal environment (device-local)"
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "local") {
              chooseEnvironment(localTerminalEnvironment);
              return;
            }
            const selected = sshEnvironments.find((item) => `ssh:${item.id}` === value);
            if (selected) chooseEnvironment({ kind: "ssh", ssh: selected });
          }}
        >
          <option value="local">Local shell</option>
          {sshEnvironments.map((item) => (
            <option key={item.id} value={`ssh:${item.id}`}>
              {item.label} · {sshEnvironmentSummary(item)}
            </option>
          ))}
        </select>
        {slotId ? (
          <button
            type="button"
            className="grid size-6 place-items-center rounded hover:bg-charcoal-hover hover:text-cream"
            onClick={closeShell}
            aria-label="Close shell session"
            title="Close shell session"
          >
            <X size={12} />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">
        {slotId ? (
          <TerminalPane
            key={slotId}
            ref={paneRef}
            slotId={slotId}
            tabId={tabId}
            visible
            focused
            onTitleChange={setTitle}
            onCwdChange={setCwd}
            environment={environment}
            onSessionStatusChange={setSessionStatus}
            onCancelSsh={() => chooseEnvironment(localTerminalEnvironment)}
          />
        ) : (
          <TerminalEmptyState onNewShell={newShell} />
        )}
      </div>
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

function TerminalEmptyState(props: { onNewShell: () => void; disabled?: boolean }) {
  return (
    <div className="grid h-full place-items-center bg-[#111312] p-6">
      <div className="text-center">
        <SquareTerminal size={28} className="mx-auto mb-3 text-cream-muted" />
        <p className="mb-4 text-sm text-cream-muted">No shell is running.</p>
        <button
          type="button"
          disabled={props.disabled}
          onClick={props.onNewShell}
          className="rounded-md border border-charcoal-border bg-charcoal-card px-3 py-1.5 text-xs text-cream hover:bg-charcoal-hover disabled:opacity-50"
        >
          New Shell
        </button>
      </div>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function shortenHome(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
