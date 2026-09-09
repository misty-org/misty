import type {
  MistySurfaceAdapter,
  MistyAiArtifact,
  MistyAiContextReference,
  MistyAiCitation,
} from "@misty/sdk";
import { AppRpcError, rpcString, type AppRpcScope } from "./session";

const surfacesByApp: Record<string, readonly string[]> = {
  terminal: ["terminal"],
  code: ["code"],
  files: ["files", "transfers"],
  browser: ["browser"],
  journal: ["notes", "drawings"],
  planner: ["planner.tasks", "planner.agenda", "planner.roadmap"],
  chat: ["space.chat"],
  inbox: ["inbox"],
  library: ["library"],
  agents: ["agents"],
};
/** Callback capability for trusted signed components, with no authenticated store sharing. */
export function createAppSurfaceBridge(
  scope: AppRpcScope,
  publish: (surface: MistySurfaceAdapter | null) => void,
) {
  let current: (() => void) | undefined;
  let published: MistySurfaceAdapter | null = null;
  const close = () => {
    current?.();
    current = undefined;
  };
  scope.signal.addEventListener("abort", close, { once: true });
  return {
    read: () => published,
    async register(adapter: MistySurfaceAdapter) {
      scope.assert("ai.use");
      if (
        !adapter ||
        !surfacesByApp[scope.identity.appId]?.includes(adapter.surfaceId) ||
        typeof adapter.getContext !== "function"
      )
        throw new AppRpcError("invalid_surface", "This AI surface does not belong to the App.");
      const label = rpcString(adapter.label, 160);
      // Copy callbacks at registration. Mutating the original object cannot replace
      // a guarded callback with another Host operation after it has been checked.
      const source = { ...adapter };
      let removed = false;
      const assert = () => {
        scope.assert("ai.use");
        if (removed) throw new AppRpcError("surface_closed", "This App surface has closed.");
      };
      const space = (value: { spaceId?: string }) => {
        if (value.spaceId && value.spaceId !== scope.identity.spaceId)
          throw new AppRpcError("space_mismatch", "The App surface referenced a different Space.");
      };
      const value = <T>(read: () => T): T => {
        assert();
        const result = structuredClone(read());
        assert();
        return result;
      };
      const artifact = (input: MistyAiArtifact) => {
        assert();
        if (input.target) space(input.target);
        if (
          Date.parse(input.expiresAt) <= Date.now() ||
          !Number.isFinite(Date.parse(input.expiresAt))
        )
          throw new AppRpcError("artifact_expired", "The proposed change expired.");
        return structuredClone(input);
      };
      const guarded: MistySurfaceAdapter = Object.freeze({
        surfaceId: source.surfaceId,
        label,
        getContext: () => {
          const result = value(() => source.getContext());
          if (!Array.isArray(result) || result.length > 100)
            throw new AppRpcError("invalid_context", "Invalid App context.");
          result.forEach((item: MistyAiContextReference) => {
            space(item);
            rpcString(item.kind, 160);
            rpcString(item.id, 512);
          });
          return result;
        },
        getSelection: source.getSelection
          ? () => {
              const result = value(() => source.getSelection!());
              if (result) {
                space(result.object);
                if ((result.content?.length ?? 0) > 65536)
                  throw new AppRpcError("invalid_context", "App selection is too large.");
              }
              return result;
            }
          : undefined,
        getSuggestedActions: source.getSuggestedActions
          ? () => value(() => source.getSuggestedActions!())
          : undefined,
        canApply: source.canApply
          ? (input: MistyAiArtifact) => {
              try {
                return Boolean(value(() => source.canApply!(artifact(input))));
              } catch {
                return false;
              }
            }
          : undefined,
        applyArtifact: source.applyArtifact
          ? async (input: MistyAiArtifact) => {
              await source.applyArtifact!(artifact(input));
              assert();
            }
          : undefined,
        undoArtifact: source.undoArtifact
          ? async (input: MistyAiArtifact) => {
              assert();
              if (input.target) space(input.target);
              await source.undoArtifact!(structuredClone(input));
              assert();
            }
          : undefined,
        openCitation: source.openCitation
          ? (citation: MistyAiCitation) => {
              assert();
              rpcString(citation.href, 8192);
              source.openCitation!(structuredClone(citation));
            }
          : undefined,
        onArtifactApplied: source.onArtifactApplied
          ? async (input: MistyAiArtifact) => {
              assert();
              if (input.target) space(input.target);
              await source.onArtifactApplied!(structuredClone(input));
              assert();
            }
          : undefined,
      });
      close();
      const remove = () => {
        if (removed) return;
        removed = true;
        if (current === remove) {
          current = undefined;
          published = null;
          publish(null);
        }
      };
      current = remove;
      published = guarded;
      publish(guarded);
      return remove;
    },
    close() {
      scope.signal.removeEventListener("abort", close);
      close();
    },
  };
}
