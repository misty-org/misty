import { useAuth } from "@/features/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAiSurfaceStore } from "./store";
import { AiProactiveNudge } from "./AiRecap";
import type { AiCompanionAnchor, AiSurfaceAdapter, AiSuggestedAction } from "./types";
import { useControlledProactivity } from "./useControlledProactivity";
import "./aiSurface.css";

export type {
  AiArtifact,
  AiCaptureAttachment,
  AiCompanionAnchor,
  AiContextReference,
  AiSelectionSnapshot,
  AiSuggestedAction,
  AiSurfaceAdapter,
  AiSurfaceId,
} from "./types";

interface AiPaneContextValue {
  paneId: string;
  accountId: string;
  adapter: AiSurfaceAdapter | null;
  register: (adapter: AiSurfaceAdapter) => () => void;
  update: (adapter: AiSurfaceAdapter) => void;
  summon: (anchor?: AiCompanionAnchor) => void;
}

const AiPaneContext = createContext<AiPaneContextValue | null>(null);

export function AiPaneHost({
  paneId,
  defaultAdapter = null,
  children,
}: {
  paneId: string;
  defaultAdapter?: AiSurfaceAdapter | null;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [registeredAdapter, setRegisteredAdapter] = useState<AiSurfaceAdapter | null>(null);
  const adapter = registeredAdapter ?? defaultAdapter;
  const defaultAdapterRef = useRef(defaultAdapter);
  defaultAdapterRef.current = defaultAdapter;
  const adapterRef = useRef<AiSurfaceAdapter | null>(adapter);
  adapterRef.current = adapter;
  const registerPane = useAiSurfaceStore((state) => state.registerPane);
  const updatePaneAdapter = useAiSurfaceStore((state) => state.updatePaneAdapter);
  const summonCompanion = useAiSurfaceStore((state) => state.summon);
  const setContextBoundary = useAiSurfaceStore((state) => state.setContextBoundary);
  const proactive = useControlledProactivity(accountId, adapter);

  const register = useCallback((adapter: AiSurfaceAdapter) => {
    adapterRef.current = adapter;
    setRegisteredAdapter((current) => (current === adapter ? current : adapter));
    return () => {
      if (adapterRef.current === adapter) {
        adapterRef.current = defaultAdapterRef.current;
        setRegisteredAdapter(null);
      }
    };
  }, []);
  const summon = useCallback(
    (anchor?: AiCompanionAnchor) => {
      if (accountId && adapterRef.current) summonCompanion(accountId, paneId, anchor);
    },
    [accountId, paneId, summonCompanion],
  );
  const update = useCallback(
    (next: AiSurfaceAdapter) => {
      adapterRef.current = next;
      if (!accountId) return;
      setContextBoundary(accountId, paneId, aiContextBoundary(next));
      updatePaneAdapter(accountId, paneId, next);
    },
    [accountId, paneId, setContextBoundary, updatePaneAdapter],
  );
  const context = useMemo<AiPaneContextValue>(
    () => ({ paneId, accountId, adapter, register, update, summon }),
    [accountId, adapter, paneId, register, summon, update],
  );

  useEffect(() => {
    const element = hostRef.current;
    const currentAdapter = adapterRef.current;
    if (!accountId || !currentAdapter || !element) return;
    setContextBoundary(accountId, paneId, aiContextBoundary(currentAdapter));
    return registerPane({ accountId, paneId, adapter: currentAdapter, element });
  }, [accountId, adapter, paneId, registerPane, setContextBoundary]);

  return (
    <AiPaneContext.Provider value={context}>
      <div ref={hostRef} className="misty-ai-pane-host">
        <div className="misty-ai-pane-content">{children}</div>
        {proactive && adapter ? (
          <AiProactiveNudge
            accountId={accountId}
            paneId={paneId}
            adapter={adapter}
            reason={proactive.reason}
            onDismiss={() => void proactive.dismiss()}
            onSnooze={() => void proactive.snooze()}
            onOpen={() => {
              proactive.reviewed();
              summon();
            }}
          />
        ) : null}
      </div>
    </AiPaneContext.Provider>
  );
}

export function useAiSurfaceAdapter(adapter: AiSurfaceAdapter | null) {
  const context = useContext(AiPaneContext);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const register = context?.register;
  const update = context?.update;
  const surfaceId = adapter?.surfaceId;
  const label = adapter?.label;
  useEffect(() => {
    if (!register || !adapterRef.current) return;
    return register(adapterRef.current);
  }, [label, register, surfaceId]);
  useEffect(() => {
    if (adapter && update) update(adapter);
  }, [adapter, update]);
}

export function useAiSurfaceActions(adapter?: AiSurfaceAdapter | null) {
  const context = useContext(AiPaneContext);
  const submit = useAiSurfaceStore((state) => state.submit);
  const dismiss = useAiSurfaceStore((state) => state.dismiss);
  const decideArtifact = useAiSurfaceStore((state) => state.decideArtifact);
  const approval = useAiSurfaceStore((state) => {
    if (!context?.accountId || !context.paneId) return undefined;
    if (
      state.companion.accountId !== context.accountId ||
      state.companion.paneId !== context.paneId
    ) {
      return undefined;
    }
    return state.companion.approval;
  });
  const activeAdapter = adapter ?? context?.adapter;
  return useMemo(
    () => ({
      available: Boolean(context && activeAdapter),
      open: (anchor?: AiCompanionAnchor) => context?.summon(anchor),
      summon: (anchor?: AiCompanionAnchor) => context?.summon(anchor),
      dismiss,
      proposal: approval?.artifact,
      proposalStale: Boolean(
        approval?.artifact && activeAdapter?.canApply && !activeAdapter.canApply(approval.artifact),
      ),
      decideProposal: (decision: "accept" | "reject" | "refine") => {
        if (!context || !activeAdapter || !approval?.artifact) return Promise.resolve();
        return decideArtifact(
          context.accountId,
          context.paneId,
          activeAdapter,
          approval.artifact,
          decision,
        );
      },
      runAction: (action: AiSuggestedAction, _anchor?: AiCompanionAnchor) => {
        if (!context || !activeAdapter || !context.accountId) return Promise.resolve();
        return submit(context.accountId, context.paneId, activeAdapter, action);
      },
    }),
    [activeAdapter, approval?.artifact, context, decideArtifact, dismiss, submit],
  );
}

export function aiContextBoundary(adapter: AiSurfaceAdapter | null) {
  if (!adapter) return "none";
  const context = adapter.getContext();
  const spaces = [
    ...new Set(
      context
        .filter((item) => item.privacy === "shared")
        .map((item) => item.spaceId)
        .filter(Boolean),
    ),
  ];
  if (spaces.length) return `shared:${spaces.sort().join(",")}`;
  if (context.some((item) => item.privacy === "device" || item.privacy === "private")) {
    return "private";
  }
  if (context.some((item) => item.privacy === "provider")) return "provider";
  return `surface:${adapter.surfaceId}`;
}
