import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { AgentDock } from "@/features/agents/AgentDock";
import { agentTeammatesV1Enabled } from "@/features/agents/flags";
import { selectedPathsForPane, useExplorerStore } from "@/stores/explorer";
import { filesAgentContextLabel, setAgentDockSearch } from "@/features/agents/agentDockState";

export function useExplorerAgentDock({
  activePaneId,
  activePath,
  fallbackInspector,
}: {
  activePaneId: string;
  activePath: string;
  fallbackInspector?: ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const enabled = agentTeammatesV1Enabled();
  const open = enabled && searchParams.get("agentDock") === "1";
  const openerRef = useRef<HTMLElement | null>(null);
  const selectedPaths = useExplorerStore(
    useShallow((state) => selectedPathsForPane(state.panes[activePaneId])),
  );
  const close = useCallback(() => {
    setSearchParams(new URLSearchParams(setAgentDockSearch(searchParams.toString(), false)), {
      replace: true,
    });
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, [searchParams, setSearchParams]);
  const toggle = useCallback(() => {
    if (!open) openerRef.current = document.activeElement as HTMLElement | null;
    setSearchParams(new URLSearchParams(setAgentDockSearch(searchParams.toString(), !open)));
  }, [open, searchParams, setSearchParams]);
  const inspector = useMemo(
    () =>
      open ? (
        <AgentDock
          context={{
            surface: "files",
            label: filesAgentContextLabel(selectedPaths.length),
            cwd: activePath,
            selectedPaths,
          }}
          onClose={close}
        />
      ) : (
        fallbackInspector
      ),
    [activePath, close, fallbackInspector, open, selectedPaths],
  );
  return { enabled, open, toggle, inspector };
}
