import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/shared/ui";
import { agentsDeviceSnapshot } from "../../store/useAgentsStore";
import { ProjectReview } from "./ProjectReview";
import { useProjectReview } from "./useProjectReview";

/** The review panel beside the conversation, opened from an answer or a project. */
export function ProjectReviewSheet() {
  const { scopeId, close } = useProjectReview();
  const [name, setName] = useState("");
  useEffect(() => {
    if (!scopeId) return;
    void agentsDeviceSnapshot()
      .then((snapshot) =>
        setName(snapshot.scopes.find((scope) => scope.id === scopeId)?.displayName ?? ""),
      )
      .catch(() => undefined);
  }, [scopeId]);
  return (
    <Sheet open={Boolean(scopeId)} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        className="flex w-[min(1100px,94vw)] flex-col gap-0 p-0 sm:max-w-none"
      >
        <SheetTitle className="sr-only">Review {name || "project"}</SheetTitle>
        <SheetDescription className="sr-only">
          Uncommitted changes, history and GitHub for this project.
        </SheetDescription>
        {scopeId ? (
          <ProjectReview key={scopeId} scopeId={scopeId} name={name || "Project"} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
