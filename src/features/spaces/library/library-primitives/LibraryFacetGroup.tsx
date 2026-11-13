import type { LibrarySearchFacets } from "../../api/dto/entities";
import { Button, Text } from "@/shared/ui";

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
      <Text bare tone="muted" weight="semibold" className="mr-0.5 text-3xs capitalize">
        {label}
      </Text>
      {facets.slice(0, MAX_VISIBLE_FACETS).map((facet) => (
        <Button
          variant="secondary"
          type="button"
          key={`${facet.value}:${facet.label}`}
          onClick={() => onSelect(facet)}
        >
          {facet.label}
          <Text bare tone="muted">
            {facet.count}
          </Text>
        </Button>
      ))}
    </div>
  );
}
