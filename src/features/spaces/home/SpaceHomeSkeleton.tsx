import { CollectionHeading, CollectionPage, Skeleton, SkeletonControl, Surface } from "@misty/ui";
import { HomeSection } from "./HomeSection";
import { homeChipsClass, homePairClass, spaceHomeClass } from "./homeLayout";
import { OverviewCard, OverviewRowsSkeleton } from "./OverviewCard";
import { ActivityRowsSkeleton } from "./SpaceActivityLog";

const placeWidths = ["w-10", "w-12", "w-14", "w-16", "w-12", "w-10"];

/**
 * A Space's home while the Space itself is first read, built from the home's own pieces so it
 * keeps their exact geometry: the top bar with the Space's name and its controls, the row of
 * page chips, then the overview's panels with their rows.
 */
export function SpaceHomeSkeleton() {
  return (
    <CollectionPage role="status" aria-label="Space" aria-busy="true">
      <span className="sr-only">Space</span>
      <CollectionHeading
        title={<Skeleton className="h-4 w-32" />}
        end={
          <div className="flex min-w-0 items-center gap-2" aria-hidden="true">
            <SkeletonControl kind="field" className="w-56" />
            <SkeletonControl kind="button" />
          </div>
        }
      />
      <div className={spaceHomeClass} aria-hidden="true">
        <HomeSection title="Pages">
          <div className={homeChipsClass}>
            {placeWidths.map((width, index) => (
              <Surface
                key={index}
                tone="faint"
                radius="lg"
                className="inline-flex h-8 items-center gap-2 px-3"
              >
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className={`h-3 ${width}`} />
              </Surface>
            ))}
          </div>
        </HomeSection>
        <div className={homePairClass}>
          <OverviewCard title="Recent activity">
            <ActivityRowsSkeleton rows={3} />
          </OverviewCard>
          <OverviewCard title="Coming up">
            <OverviewRowsSkeleton rows={3} kind="schedule" trailing="w-14" />
          </OverviewCard>
        </div>
      </div>
    </CollectionPage>
  );
}
