import { Text } from "@/shared/ui";
import type { GitStatus } from "./gitApi";

/** Lines added and removed across the folder's changed files, in their own colors. */
export function LineCounts({ git }: { git: GitStatus }) {
  let added = 0;
  let removed = 0;
  for (const entry of [...git.staged, ...git.unstaged, ...git.untracked]) {
    added += entry.additions ?? 0;
    removed += entry.deletions ?? 0;
  }
  if (!added && !removed) return null;
  return (
    <span className="flex gap-1.5">
      <Text bare tone="added">
        +{added}
      </Text>
      <Text bare tone="removed">
        −{removed}
      </Text>
    </span>
  );
}
