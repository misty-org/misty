import { CollectionHeading, CollectionPage, Skeleton, SkeletonControl, Surface } from "@/shared/ui";
import { HomeSection } from "./HomeSection";
import { homePairClass, homePlaceClass, homePlacesClass, spaceHomeClass } from "./homeLayout";
import { OverviewCard, OverviewRowsSkeleton } from "./OverviewCard";

const placeWidths = ["w-10", "w-12", "w-14", "w-16", "w-12", "w-10"];

/**
 * A Space's home while the Space itself is first read, built from the home's own pieces so it
 * keeps their exact geometry: the top bar with the Space's name and its controls, the row of
 * page tiles, then the overview's panels with their rows.
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
          <div className={homePlacesClass}>
            {placeWidths.map((width, index) => (
              <Surface
                key={index}
                tone="card"
                edge="hairline"
                radius="xl"
                className={homePlaceClass}
              >
                <Skeleton className="size-7 shrink-0 rounded-lg" />
                <Skeleton className={`h-3.5 ${width}`} />
              </Surface>
            ))}
          </div>
        </HomeSection>
        <div className={homePairClass}>
          <OverviewCard title="Recent chats">
            <OverviewRowsSkeleton rows={3} />
          </OverviewCard>
          <OverviewCard title="Pick up">
            <OverviewRowsSkeleton rows={2} kind="schedule" detail={false} />
          </OverviewCard>
        </div>
      </div>
    </CollectionPage>
  );
}
