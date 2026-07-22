import { Link } from "react-router";

import { PageHeader, PublicPage, ResourceNav } from "@/components/marketing/PublicPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { marketingCopy } from "@/content/marketingCopy";
import { phases, type PhaseStatus } from "./data";

const columnMeta: Record<PhaseStatus, string> = {
  development: "Planned",
  pilot: "In progress",
  available: "Shipped",
};

const columnOrder: PhaseStatus[] = ["development", "pilot", "available"];

export default function Roadmap() {
  return (
    <PublicPage>
      <PageHeader
        label="Roadmap"
        title={marketingCopy.roadmap.title}
        description={marketingCopy.roadmap.description}
      />
      <ResourceNav />

      <div className="grid items-start gap-4 py-12 lg:grid-cols-3 lg:py-16">
        {columnOrder.map((status) => {
          const phase = phases.find((item) => item.status === status);
          const items = phase?.items ?? [];

          return (
            <Card key={status} className="gap-0 rounded-xl py-0 shadow-xs ring-1 ring-foreground/10">
              <CardHeader className="flex-row items-center justify-between border-b border-border px-5 py-4">
                <CardTitle className="text-sm font-medium">{columnMeta[status]}</CardTitle>
                <Badge variant="secondary" className="tabular-nums">{items.length}</Badge>
              </CardHeader>
              <CardContent className="px-5 py-1">
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <li key={item.title} className="py-5">
                      <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="flex flex-col gap-6 rounded-xl bg-card p-6 shadow-xs ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h2 className="text-xl font-medium tracking-[-0.02em] text-foreground">Shape what comes next.</h2>
          <p className="mt-2 text-sm text-muted-foreground">Request access to the current Misty beta.</p>
        </div>
        <Button asChild size="lg" className="px-5">
          <Link to="/waitlist">Request beta access</Link>
        </Button>
      </section>
    </PublicPage>
  );
}
