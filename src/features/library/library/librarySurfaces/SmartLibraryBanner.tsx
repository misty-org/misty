import { Button } from "@/shared/ui";
import { BrainCircuit } from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";

/** The Smart Library explainer and its owner-only AI switches. */
export function SmartLibraryBanner() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const { collection, peoplePolicy, activeSpace } = data;
  if (collection !== "smart" || !peoplePolicy) return null;

  const queued = peoplePolicy.queued_ai_jobs;
  const status = !peoplePolicy.ai_enabled
    ? "Analysis is off"
    : queued > 0
      ? `${queued} item${queued === 1 ? "" : "s"} queued for analysis`
      : "Analysis is on and up to date";

  return (
    <section className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-charcoal-border bg-charcoal-card p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-charcoal-active text-cream-bright">
          <BrainCircuit size={18} />
        </span>
        <div>
          <h2 className="m-0 text-sm font-semibold">Smart Library</h2>
          <p className="mb-0 mt-1 max-w-xl text-xs text-cream-muted">
            Search this Space by meaning and use generated captions and tags. Analysis pauses at the
            weekly Hosted AI limit without blocking uploads.
          </p>
          <p className="mb-0 mt-2 text-[11px] text-cream-muted">{status}</p>
        </div>
      </div>
      {activeSpace?.role === "owner" ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={peoplePolicy.ai_enabled ? "secondary" : "default"}
            onClick={() => void collectionActions.toggleIntelligencePolicy("ai")}
          >
            {peoplePolicy.ai_enabled ? "Turn off" : "Enable Smart Library"}
          </Button>
          {peoplePolicy.ai_enabled ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void collectionActions.toggleIntelligencePolicy("semantic")}
            >
              {peoplePolicy.semantic_search_enabled
                ? "Semantic search on"
                : "Enable semantic search"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
