import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { useMemo } from "react";
import { languageOf } from "../codeWorkspaceSupport";
import { useCodingWorkspaceStore, type OpenTab } from "../store/useCodingWorkspaceStore";
import { applyUnifiedPatch } from "./applyUnifiedPatch";

export function useCodeAiAdapter(options: {
  buffer: OpenTab | null;
  bufferId?: string;
  rootPath: string | null;
}) {
  const { buffer, rootPath } = options;
  const adapter = useMemo<AiSurfaceAdapter>(() => {
    const bufferId = options.bufferId ?? "code";
    const patchForBuffer = (artifact: AiArtifact) => {
      if (
        artifact.kind !== "code_patch" ||
        !buffer ||
        !rootPath ||
        buffer.readonly ||
        buffer.loading ||
        buffer.error ||
        buffer.contents.length > 32 << 10
      )
        return "";
      const operations = artifact.operations as {
        files?: Array<{
          buffer_id?: string;
          filename?: string;
          base_hash?: string;
          patch?: string;
        }>;
      };
      const file = operations.files?.length === 1 ? operations.files[0] : undefined;
      return file?.buffer_id === bufferId &&
        file.filename === buffer.name &&
        file.base_hash === codeAiHash(buffer.contents) &&
        typeof file.patch === "string"
        ? file.patch
        : "";
    };
    return {
      surfaceId: "code",
      label: buffer?.name || "Code workspace",
      getContext: () => [
        {
          kind: "code.workspace",
          id: bufferId,
          title: buffer?.name || "Code workspace",
          privacy: "device",
          opaqueScopeId: rootPath ? `repo-${codeAiHash(rootPath)}` : undefined,
          metadata: { language: languageOf(buffer?.name), has_active_file: Boolean(buffer) },
        },
      ],
      getSelection: () => {
        if (!buffer) return null;
        const content = buffer.contents.slice(0, 32 << 10);
        return {
          kind: "text",
          content,
          object: { kind: "code.buffer", id: bufferId },
          anchors: { filename: buffer.name, language: languageOf(buffer.name) },
          contentHash: codeAiHash(content),
        };
      },
      getSuggestedActions: () => [
        {
          id: "explain-code",
          label: "Explain",
          prompt: "Explain the active code, its important control flow, and any assumptions.",
        },
        {
          id: "review-code",
          label: "Review",
          prompt:
            "Review the active code for correctness, security, maintainability, and missing tests. Cite relevant lines descriptively.",
        },
        {
          id: "suggest-tests",
          label: "Suggest tests",
          prompt:
            "Propose focused tests for the active code, including edge cases. Do not modify files.",
        },
        {
          id: "draft-code-patch",
          label: "Draft patch",
          prompt:
            "Propose a unified diff for only the active buffer, anchored to its exact buffer ID and content hash. Do not save or run tests.",
          requestedArtifactKind: "code_patch",
        },
        {
          id: "plan-change",
          label: "Plan a change",
          prompt:
            "Create an implementation plan for changing this code. Do not modify files or run commands.",
        },
      ],
      canApply: (artifact) => Boolean(patchForBuffer(artifact)),
      applyArtifact: async (artifact) => {
        const patch = patchForBuffer(artifact);
        if (!patch || !buffer || !rootPath)
          throw new Error("The code buffer changed. Ask Misty to regenerate this patch.");
        const next = applyUnifiedPatch(buffer.contents, patch);
        useCodingWorkspaceStore.getState().updateBufferContents(rootPath, buffer.path, next);
      },
    };
  }, [buffer, options.bufferId, rootPath]);
  useAiSurfaceAdapter(adapter);
}

function codeAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
