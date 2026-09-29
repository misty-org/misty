import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui";
import { skippedLabel, syncedLabel, websiteDataSummary, type WebsiteDataSite } from "./websiteData";

function SiteRow({ site }: { site: WebsiteDataSite }) {
  return (
    <li className="py-2" data-website-data-site={site.site}>
      <p className="truncate text-sm font-medium text-cream-bright">{site.site}</p>
      {site.synced.length > 0 && (
        <p className="text-sm text-cream-muted">
          Synced: {site.synced.map(syncedLabel).join(", ")}
        </p>
      )}
      {site.skipped.map((skip) => (
        <p key={`${skip.kind}:${skip.reason}`} className="text-sm text-avatar-yellow">
          Not synced · {skippedLabel(skip)}
        </p>
      ))}
    </li>
  );
}

/** What each website's cookies and storage contributed to the last sync. */
export function WebsiteDataCoverage({ sites }: { sites: WebsiteDataSite[] }) {
  const summary = websiteDataSummary(sites);
  if (!summary) return null;
  const partial = sites.filter((site) => site.skipped.length > 0);
  const complete = sites.filter((site) => site.skipped.length === 0);
  return (
    <section aria-label="Website data by site" className="px-5 pb-3">
      <p role="status" className="text-sm text-cream-muted">
        {summary}
      </p>
      {partial.length > 0 && (
        <ul className="mt-1 divide-y divide-charcoal-border">
          {partial.map((site) => (
            <SiteRow key={site.site} site={site} />
          ))}
        </ul>
      )}
      {complete.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group mt-2 flex items-center gap-1 text-sm text-cream-muted hover:text-cream-bright">
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform group-data-[state=open]:rotate-90"
            />
            Fully synced sites ({complete.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y divide-charcoal-border">
              {complete.map((site) => (
                <SiteRow key={site.site} site={site} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
