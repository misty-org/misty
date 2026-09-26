import type { LibrarySearchFacets } from "@/api/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";

type Facet = LibrarySearchFacets["tags"][number];

const MAX_VISIBLE_FACETS = 6;

/** A labelled row of search facet chips, capped so the toolbar cannot wrap away. */
export function LibraryFacetGroup({
  label,
  facets,
  onSelect,
}: {
  label: string;
  facets: Facet[];
  onSelect: (facet: Facet) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="mr-0.5 text-[10px] font-semibold capitalize text-cream-muted">{label}</span>
      {facets.slice(0, MAX_VISIBLE_FACETS).map((facet) => (
        <Button
          size="sm"
          variant="outline"
          type="button"
          key={`${facet.value}:${facet.label}`}
          onClick={() => onSelect(facet)}
        >
          {facet.label}
          <span className="text-cream-muted">{facet.count}</span>
        </Button>
      ))}
    </div>
  );
}
