import { useState } from "react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { ScheduledCollection } from "@/features/scheduled/ScheduledCollection";
import {
  Button,
  CollectionHeading,
  CollectionPage,
  CollectionSearch,
  CollectionViewToggle,
} from "@/shared/ui";
import { MistyDashboard } from "../components/MistyDashboard";

type Section = "activity" | "scheduled";

/** Account-wide runs and scheduled tasks, formerly sections of the Agents collection. */
export function AgentActivityPage({ initialSection = "activity" }: { initialSection?: Section }) {
  const [params] = useSearchParams();
  const [section, setSection] = useState<Section>(initialSection);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [creating, setCreating] = useState(false);
  const label = section === "scheduled" ? "Search scheduled tasks" : "Search activity";
  return (
    <div className="agent-studio-page-scroll">
      <CollectionPage className="w-full">
        <CollectionHeading
          title="Activity"
          actions={
            <>
              <CollectionSearch
                aria-label={label}
                placeholder={label}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
              {section === "scheduled" && (
                <Button variant="primary" className="px-4" onClick={() => setCreating(true)}>
                  <Plus />
                  New scheduled task
                </Button>
              )}
            </>
          }
        />
        <CollectionFilters
          collectionId="agents"
          options={[
            { value: "activity", label: "Recent" },
            { value: "scheduled", label: "Scheduled" },
          ]}
          value={section}
          onChange={(value) => {
            setSection(value === "scheduled" ? "scheduled" : "activity");
            setQuery("");
          }}
          actions={<CollectionViewToggle value={view} onChange={setView} />}
        />
        {section === "scheduled" ? (
          <ScheduledCollection
            query={query}
            view={view}
            creating={creating}
            onCreatingChange={setCreating}
          />
        ) : (
          <MistyDashboard
            collection={{ query, view, activityId: params.get("activity") ?? undefined }}
          />
        )}
      </CollectionPage>
    </div>
  );
}
