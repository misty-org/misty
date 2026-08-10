import { PageHeader, PublicPage, ResourceNav } from "@/components/marketing";
import { Badge } from "@/components/ui/badge";
import { marketingCopy } from "@/content/marketingCopy";
import { changelog } from "./data";

export default function Changelog() {
  return (
    <PublicPage>
      <PageHeader
        label="Changelog"
        title={marketingCopy.changelog.title}
        description={marketingCopy.changelog.description}
      />
      <ResourceNav />

      <div>
        {changelog.map((entry) => (
          <article key={entry.version} className="grid gap-7 border-b border-border py-10 sm:grid-cols-[10rem_1fr] sm:gap-12">
            <div className="sm:sticky sm:top-28 sm:self-start">
              <p className="text-sm font-medium text-foreground">{entry.date}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{entry.version}</Badge>
                <Badge variant="outline">{entry.status}</Badge>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-medium tracking-[-0.03em] text-foreground">{entry.summary}</h2>
              <div className="mt-7 grid gap-7 md:grid-cols-2">
                {entry.groups.map((group) => (
                  <section key={group.heading}>
                    <h3 className="mb-3 text-sm font-medium text-foreground">{group.heading}</h3>
                    <ul className="divide-y divide-border border-y border-border">
                      {group.changes.map((change) => (
                        <li key={change} className="py-3 text-sm leading-6 text-muted-foreground">
                          {change}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </PublicPage>
  );
}
