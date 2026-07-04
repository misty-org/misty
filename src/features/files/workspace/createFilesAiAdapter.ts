import type {
  MistySurfaceAdapter,
  MistyAiArtifact as AiArtifact,
} from "@misty/sdk";
import type { FileEntry } from "@/native/contracts";

/** Metadata-only context. Native file authority stays with the calling workspace. */
export function createFilesAiAdapter(options: {
  viewId: string;
  canMutate: boolean;
  selected(): FileEntry[];
  rename(entry: FileEntry, name: string): Promise<unknown>;
  trash(): Promise<unknown>;
}): MistySurfaceAdapter {
  const selectedEntries = options.selected().slice(0, 100);
  const entries = selectedEntries.map((entry) => ({
    id: `file-${filesAiHash(entry.id)}`,
    name: entry.name,
    kind: entry.kind,
    extension: entry.extension,
    mime_type: entry.mimeType,
    size_bytes: entry.sizeBytes,
    modified_ms: entry.modifiedMs,
    readonly: entry.readonly,
    location: entry.location.kind,
  }));
  const content = JSON.stringify({ selected: entries }).slice(0, 32 << 10);
  const applicablePlan = (artifact: AiArtifact) => {
    if (
      artifact.kind !== "file_plan" ||
      !options.canMutate ||
      selectedEntries.length === 0
    )
      return null;
    const operations = artifact.operations as {
      steps?: Array<{
        action?: string;
        source_scope_id?: string;
        destination_scope_id?: string;
        display_name?: string;
        conflict_policy?: string;
      }>;
    };
    const steps = operations.steps;
    if (!steps?.length || steps.length > 100) return null;
    const byScope = new Map<string, (typeof selectedEntries)[number]>(
      selectedEntries.map(
        (entry) => [`file-${filesAiHash(entry.id)}`, entry] as const,
      ),
    );
    if (
      steps.some(
        (step) =>
          !byScope.has(step.source_scope_id ?? "") ||
          step.conflict_policy !== "ask",
      )
    )
      return null;
    if (
      selectedEntries.length === 1 &&
      steps.length === 1 &&
      steps[0].action === "rename"
    ) {
      const entry = byScope.get(steps[0].source_scope_id ?? "");
      const name = steps[0].display_name?.trim() ?? "";
      return entry &&
        !entry.readonly &&
        entry.location.kind === "local" &&
        name &&
        name !== entry.name &&
        !name.includes("/") &&
        !name.includes("\\") &&
        !Array.from(name).some((character) => character.charCodeAt(0) === 0)
        ? { kind: "rename" as const, name }
        : null;
    }
    const sourceIds = new Set(steps.map((step) => step.source_scope_id));
    return steps.every((step) => step.action === "trash") &&
      sourceIds.size === selectedEntries.length &&
      selectedEntries.every(
        (entry) =>
          sourceIds.has(`file-${filesAiHash(entry.id)}`) &&
          !entry.readonly &&
          entry.location.kind === "local",
      )
      ? { kind: "trash" as const }
      : null;
  };
  return {
    surfaceId: "files",
    label: entries.length
      ? `${entries.length} selected file${entries.length === 1 ? "" : "s"}`
      : "Files",
    getContext: () => [
      {
        kind: "files.scope",
        id: options.viewId,
        title: entries.length
          ? `${entries.length} selected item${entries.length === 1 ? "" : "s"}`
          : "Current file view",
        privacy: "device",
        opaqueScopeId: `files-${filesAiHash(options.viewId)}`,
        metadata: { selected_count: entries.length },
      },
    ],
    getSelection: () =>
      entries.length
        ? {
            kind: "objects",
            content,
            object: { kind: "files.selection", id: options.viewId },
            anchors: { count: entries.length },
            contentHash: filesAiHash(content),
          }
        : null,
    getSuggestedActions: () => [
      {
        id: "explain-selection",
        label: "Explain selection",
        prompt:
          "Summarize the selected file metadata and call out anything unusual. Do not claim to have read file contents.",
      },
      {
        id: "cleanup-plan",
        label: "Cleanup plan",
        prompt:
          "Propose a safe organization and cleanup plan for the selected items. Do not move, rename, or delete anything.",
      },
      {
        id: "review-file-change",
        label: "Review file change",
        prompt:
          "Propose only a local rename for one selected item or moving every selected local item to Trash. " +
          "Use the exact opaque source IDs and conflict policy ask. Do not execute it.",
        requestedArtifactKind: "file_plan",
      },
      {
        id: "find-patterns",
        label: "Find patterns",
        prompt:
          "Find naming, type, size, and recency patterns in the selected file metadata.",
      },
      {
        id: "search-strategy",
        label: "Search strategy",
        prompt:
          "Suggest precise searches or filters to find related files without exposing raw local paths.",
      },
    ],
    canApply: (artifact) => Boolean(applicablePlan(artifact)),
    applyArtifact: async (artifact) => {
      const plan = applicablePlan(artifact);
      if (!plan)
        throw new Error(
          "The file selection or device capability changed. Ask Misty to regenerate this plan.",
        );
      const current = options.selected();
      if (
        current.length !== selectedEntries.length ||
        current.some(
          (entry, index) =>
            entry.id !== selectedEntries[index].id ||
            entry.path !== selectedEntries[index].path ||
            entry.modifiedMs !== selectedEntries[index].modifiedMs ||
            entry.readonly !== selectedEntries[index].readonly,
        )
      )
        throw new Error(
          "The file selection changed. Ask Misty to regenerate this plan.",
        );
      if (plan.kind === "rename")
        await options.rename(selectedEntries[0], plan.name);
      else await options.trash();
    },
  };
}

function filesAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
