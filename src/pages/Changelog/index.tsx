import { NavLink } from "react-router";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { changelog } from "./data";

const resourceTabs = [
  { to: "/blog", label: "Blog" },
  { to: "/changelog", label: "Changelog" },
  { to: "/roadmap", label: "Roadmap" },
];

export default function Changelog() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-28 sm:px-6 sm:pt-32">
      <header className="text-center">
        <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Changelog
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">
          What&rsquo;s new in Misty
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          Features, improvements, and fixes from the beta.
        </p>

        <nav aria-label="Resources" className="mt-8 flex justify-center">
          <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
            {resourceTabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-foreground/70 hover:text-foreground",
                  )
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <div className="mt-14 flex flex-col">
        {changelog.map((entry, index) => (
          <article
            key={entry.version}
            className={cn(
              "grid gap-6 py-10 sm:grid-cols-[10rem_1fr] sm:gap-10",
              index > 0 && "border-t border-border",
            )}
          >
            <div className="sm:sticky sm:top-28 sm:self-start">
              <p className="text-sm font-medium text-foreground">{entry.date}</p>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="secondary" className="rounded font-mono">
                  {entry.version}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {entry.status}
                </Badge>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold tracking-[-0.01em] text-foreground sm:text-2xl">
                {entry.summary}
              </h2>

              <div className="mt-6 space-y-6">
                {entry.groups.map((group) => (
                  <section key={group.heading}>
                    <h3 className="mb-3 text-sm font-semibold text-foreground">{group.heading}</h3>
                    <ul className="space-y-2.5">
                      {group.changes.map((change) => (
                        <li key={change} className="text-sm leading-6 text-muted-foreground">
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
    </div>
  );
}
