import { FileDiff } from "lucide-react";
import { useEffect, useState } from "react";
import type { GlobalAiMessage } from "@/features/global-search/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Skeleton } from "@/shared/ui";
import { agentsDeviceSnapshot, projectGitDiff } from "../../store/useAgentsStore";
import { useConversationProject } from "../../store/useConversationProject";
import { DiffCounts, DiffFile } from "./DiffView";
import type { DiffSet } from "./diffTypes";
import { useProjectReview } from "./useProjectReview";

/** An answer that handed coding to the person's coding tool. */
const delegated = /^code[._]delegate$/;

export function delegatedCoding(message: GlobalAiMessage): boolean {
  return Boolean(
    message.progress?.some((item) => item.type === "tool" && delegated.test(item.name)),
  );
}

/**
 * What the project looks like after an answer that delegated coding, like
 * Claude Code and Codex show it: the files git sees as changed since the last
 * commit, with their +/- counts, each opening to its diff, and Review. Shown
 * only on the computer the project is on.
 */
export function AnswerChanges({
  message,
  conversationId,
}: {
  message: GlobalAiMessage;
  conversationId?: string;
}) {
  const finished = message.state !== "pending" && message.state !== "streaming";
  const scopeId = useConversationProject((s) =>
    conversationId ? s.byConversation[conversationId] : null,
  );
  const relevant = Boolean(finished && scopeId && hasTauriInternals() && delegatedCoding(message));
  const [name, setName] = useState("");
  const [diff, setDiff] = useState<DiffSet | null>();
  const openReview = useProjectReview((s) => s.open);
  useEffect(() => {
    if (!relevant || !scopeId) return;
    let current = true;
    void agentsDeviceSnapshot()
      .then(
        (snapshot) =>
          current &&
          setName(
            snapshot.scopes.find((scope) => scope.id === scopeId)?.displayName ?? "the project",
          ),
      )
      .catch(() => undefined);
    void projectGitDiff(scopeId)
      .then((set) => current && setDiff(set))
      .catch(() => current && setDiff(null));
    return () => {
      current = false;
    };
  }, [relevant, scopeId]);
  if (!relevant || !scopeId || diff === null) return null;
  if (diff === undefined)
    return (
      <div className="misty-changes" aria-hidden="true">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  if (!diff.files.length) return null;
  const count = diff.files.length + diff.moreFiles;
  return (
    <section className="misty-changes" aria-label={`Changes to ${name}`}>
      <header className="misty-changes-header">
        <FileDiff size={15} aria-hidden="true" />
        <strong>
          {count} {count === 1 ? "file" : "files"} changed in {name}
        </strong>
        <DiffCounts additions={diff.additions} deletions={diff.deletions} />
        <span className="misty-changes-actions">
          <Button variant="ghost" size="sm" onClick={() => openReview(scopeId)}>
            Review
          </Button>
        </span>
      </header>
      <div className="misty-diff">
        {diff.files.map((file) => (
          <DiffFile key={file.path} file={file} defaultOpen={false} />
        ))}
      </div>
    </section>
  );
}
