import type { MistySurfaceAdapter, MistyAiControlsSnapshot } from "@misty/sdk";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { AppRpcError, type AppRpcScope } from "./session";
import type { AiControlsBackend } from "./aiControls";
import type { AiArtifact } from "@/features/ai-surface/types";

/** The SDK can operate only its currently registered, visible workspace surface. */
export function createAiControlsBackend(
  scope: AppRpcScope,
  readSurface: () => MistySurfaceAdapter | null,
): AiControlsBackend {
  const owned = () => {
    scope.assert("ai.use");
    const surface = readSurface();
    const workspace = useWorkspaceStore.getState();
    const pane = dockLeaves(workspace.layout.root).find(
      (pane) =>
        pane.activeTabId === scope.identity.instanceId &&
        pane.tabs.some(
          (tab) =>
            tab.id === scope.identity.instanceId && tab.groupKey === `app:${scope.identity.appId}`,
        ),
    );
    const state = useAiSurfaceStore.getState();
    const registration = pane && state.registrations[`${scope.identity.accountId}:${pane.id}`];
    if (
      !surface ||
      !pane ||
      registration?.adapter !== surface ||
      registration.accountId !== scope.identity.accountId
    )
      throw new AppRpcError("surface_inactive", "Open this App view before using its AI controls.");
    return { surface, paneId: pane.id, state };
  };
  const ownedProposal = (owner: ReturnType<typeof owned>): AiArtifact | undefined => {
    const companion = owner.state.companion;
    if (companion.accountId !== scope.identity.accountId || companion.paneId !== owner.paneId)
      return;
    const artifact = companion.approval?.artifact;
    if (!artifact?.target) return;
    const target = artifact.target;
    if (target.spaceId && target.spaceId !== scope.identity.spaceId) return;
    if (
      !owner.surface
        .getContext()
        .some(
          (context) =>
            context.id === target.id &&
            context.kind === target.kind &&
            (!context.spaceId || context.spaceId === (target.spaceId ?? scope.identity.spaceId)),
        )
    )
      return;
    return artifact;
  };
  const stale = (owner: ReturnType<typeof owned>, artifact: AiArtifact) =>
    !Number.isFinite(Date.parse(artifact.expiresAt)) ||
    Date.parse(artifact.expiresAt) <= Date.now() ||
    owner.surface.canApply?.(artifact) === false;
  return {
    snapshot(): MistyAiControlsSnapshot {
      let owner: ReturnType<typeof owned>;
      try {
        owner = owned();
      } catch (error) {
        if (error instanceof AppRpcError && error.code === "surface_inactive")
          return { available: false, following: false };
        throw error;
      }
      const companion = owner.state.companion;
      const artifact = ownedProposal(owner);
      const replacement =
        artifact?.kind === "text_patch" &&
        artifact.operations &&
        typeof artifact.operations === "object"
          ? (artifact.operations as { replacement?: unknown }).replacement
          : undefined;
      return {
        available: true,
        following:
          companion.accountId === scope.identity.accountId &&
          companion.paneId === owner.paneId &&
          companion.phase === "following",
        ...(artifact
          ? {
              proposal: {
                id: artifact.id,
                kind: artifact.kind,
                state: artifact.state,
                stale: stale(owner, artifact),
                ...(typeof replacement === "string" && replacement.length <= 65536
                  ? { replacement }
                  : {}),
              },
            }
          : {}),
      };
    },
    async run({ actionId, selectionHash }) {
      const owner = owned();
      const selection = owner.surface.getSelection?.();
      if (selectionHash !== undefined && selection?.contentHash !== selectionHash)
        throw new AppRpcError(
          "selection_changed",
          "The selection changed. Choose the action again.",
        );
      const actions = owner.surface.getSuggestedActions?.() ?? [];
      if (!Array.isArray(actions) || actions.length > 100)
        throw new AppRpcError("invalid_actions", "Invalid App AI actions.");
      const action = actions.find((action) => action.id === actionId);
      if (
        !action ||
        typeof action.prompt !== "string" ||
        !action.prompt.trim() ||
        action.prompt.length > 8192
      )
        throw new AppRpcError("action_unavailable", "This AI action is no longer available.");
      owner.state.follow(scope.identity.accountId, owner.paneId);
      // Use the guarded registration, never an adapter supplied in RPC parameters.
      await useAiSurfaceStore
        .getState()
        .submit(scope.identity.accountId, owner.paneId, owner.surface, action);
    },
    async decide({ proposalId, decision }) {
      const owner = owned();
      const artifact = ownedProposal(owner);
      if (!artifact || artifact.id !== proposalId)
        throw new AppRpcError(
          "proposal_unavailable",
          "This proposal is no longer available in the App view.",
        );
      if (decision === "accept" && (stale(owner, artifact) || artifact.state !== "proposed"))
        throw new AppRpcError(
          "proposal_stale",
          "The source changed. Ask Misty to regenerate this change.",
        );
      await owner.state.decideArtifact(
        scope.identity.accountId,
        owner.paneId,
        owner.surface,
        artifact,
        decision,
      );
    },
    subscribe(listener) {
      const removeAi = useAiSurfaceStore.subscribe(listener);
      const removeWorkspace = useWorkspaceStore.subscribe(listener);
      return () => {
        removeAi();
        removeWorkspace();
      };
    },
  };
}
