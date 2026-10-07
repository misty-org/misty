import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CollectionHeading,
  CollectionPage,
  CollectionSearch,
  CollectionViewToggle,
} from "@/shared/ui";
import { MistyDashboard } from "../components/MistyDashboard";

/**
 * Account-wide agent activity: every run, whether a chat, a workflow someone started or
 * a scheduled workflow. Schedules themselves live on their workflows.
 */
export function AgentActivityPage() {
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  return (
    <div className="agent-studio-page-scroll">
      <CollectionPage className="w-full">
        <CollectionHeading
          title="Activity"
          actions={
            <>
              <CollectionSearch
                aria-label="Search activity"
                placeholder="Search activity"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
              <CollectionViewToggle value={view} onChange={setView} />
            </>
          }
        />
        <MistyDashboard
          collection={{ query, view, activityId: params.get("activity") ?? undefined }}
        />
      </CollectionPage>
    </div>
  );
}
