import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { phases, type PhaseStatus } from "./data";

const statusMeta: Record<
  PhaseStatus,
  { badgeVariant: "secondary" | "outline"; className: string }
> = {
  available: {
    badgeVariant: "secondary",
    className: "bg-success/10 text-success",
  },
  pilot: {
    badgeVariant: "outline",
    className: "bg-muted text-foreground",
  },
  development: {
    badgeVariant: "outline",
    className: "bg-muted text-foreground/75",
  },
};

export default function Roadmap() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-32 sm:px-8 lg:px-12">
      <header className="max-w-3xl">
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl md:text-6xl">
          Product status
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
          Beta features, limited pilots, and work in development.
        </p>
      </header>

      <div className="mt-14 grid gap-6 lg:mt-16">
        {phases.map((phase) => {
          const meta = statusMeta[phase.status];

          return (
            <Card key={phase.label} className="gap-0 overflow-hidden py-0 shadow-sm">
              <CardHeader className="border-b border-border px-6 py-5 sm:px-8">
                <h2>
                  <Badge
                    variant={meta.badgeVariant}
                    className={cn("w-fit", meta.className)}
                  >
                    {phase.label}
                  </Badge>
                </h2>
              </CardHeader>

              <CardContent className="px-0">
                <ul className="grid md:grid-cols-2" aria-label={phase.label}>
                  {phase.items.map((item, index) => (
                    <li
                      key={item.title}
                      className={cn(
                        "min-h-28 border-border px-6 py-5 sm:px-8",
                        index > 0 && "border-t",
                        index === 1 && "md:border-t-0",
                        index % 2 === 1 && "md:border-l",
                      )}
                    >
                      <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                        {item.description}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="mt-10 flex flex-col gap-5 border-t border-border pt-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Request beta access.</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Access opens in small cohorts.
          </p>
        </div>
        <Button asChild size="lg" className="h-11 shrink-0 px-5">
          <Link to="/waitlist">Request beta access</Link>
        </Button>
      </section>
    </div>
  );
}
