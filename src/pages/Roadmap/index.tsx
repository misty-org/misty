import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { phases, type PhaseStatus } from "./data";

type ColumnMeta = {
  column: string;
};

// The real roadmap data is organized by availability; the board presents the
// same phases as delivery columns, ordered planned → in progress → shipped.
const columnMeta: Record<PhaseStatus, ColumnMeta> = {
  development: {
    column: "Planned",
  },
  pilot: {
    column: "In progress",
  },
  available: {
    column: "Shipped",
  },
};

const columnOrder: PhaseStatus[] = ["development", "pilot", "available"];

export default function Roadmap() {
  const columns = columnOrder.map((status) => ({
    status,
    ...columnMeta[status],
    phase: phases.find((phase) => phase.status === status),
  }));

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-32 sm:px-8 lg:px-12">
      <header className="max-w-3xl">
        <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Roadmap
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl md:text-6xl">
          Where Misty is headed
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          What is planned, in progress, and live in the beta.
        </p>
      </header>

      <div className="mt-14 grid items-start gap-5 lg:mt-16 lg:grid-cols-3">
        {columns.map(({ status, column, phase }) => {
          const items = phase?.items ?? [];

          return (
            <section
              key={status}
              aria-label={column}
              className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/25 p-4"
            >
              <div className="flex items-center px-1">
                <h2 className="text-sm font-semibold text-foreground">{column}</h2>
                <Badge variant="secondary" className="ml-auto tabular-nums">
                  {items.length}
                </Badge>
              </div>
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <li key={item.title}>
                    <Card size="sm" className="gap-2 rounded-xl">
                      <CardHeader>
                        <CardTitle className="text-sm font-semibold text-foreground">
                          {item.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-12 flex flex-col gap-5 rounded-2xl border border-border bg-muted/25 px-6 py-8 text-center sm:mt-14">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Shape what comes next.</h2>
        </div>
        <div className="flex justify-center">
          <Button asChild size="lg" className="h-11 px-5">
            <Link to="/waitlist">Request beta access</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
