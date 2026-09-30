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
        <p key={`${skip.kind}:${skip.reason}`} className="text-sm text-cream">
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
        <div>
          <h3 className="mt-3 text-xs font-medium text-cream-muted">
            Fully synced sites ({complete.length})
          </h3>
          <ul className="divide-y divide-charcoal-border">
            {complete.map((site) => (
              <SiteRow key={site.site} site={site} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
