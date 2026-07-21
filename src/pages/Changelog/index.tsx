import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { changelog } from "./data";

export default function Changelog() {
  const [openVersion, setOpenVersion] = useState(changelog[0]?.version ?? "");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-28 sm:px-6 sm:pt-32">
      <header className="border-b border-border pb-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Product updates
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">
          Changelog
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Current beta changes and availability.
        </p>
      </header>

      <div className="pt-8">
        <Accordion
          type="single"
          collapsible
          value={openVersion}
          onValueChange={setOpenVersion}
          className="mx-auto max-w-5xl space-y-3"
        >
          {changelog.map((entry) => (
            <AccordionItem
              key={entry.version}
              value={entry.version}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <AccordionTrigger className="px-6 py-4 hover:bg-muted/50 hover:no-underline">
                <div className="flex min-w-0 flex-1 items-center justify-between gap-4 pr-3">
                  <div className="flex min-w-0 items-center gap-4">
                    <Badge variant="secondary" className="rounded font-mono">
                      {entry.version}
                    </Badge>
                    <div className="min-w-0 text-left">
                      <span className="block text-sm font-medium text-foreground">
                        {entry.summary}
                      </span>
                      <span className="mt-1 block text-xs capitalize text-muted-foreground sm:hidden">
                        {entry.status}
                      </span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-3 sm:flex">
                    <Badge variant="outline" className="capitalize">
                      {entry.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{entry.date}</span>
                  </div>
                </div>
              </AccordionTrigger>

              <AccordionContent className="px-6 pt-1 pb-5">
                <div className="space-y-5">
                  {entry.groups.map((group) => (
                    <section key={group.heading}>
                      <h2 className="mb-2 text-sm font-semibold text-foreground">{group.heading}</h2>
                      <ul className="space-y-2">
                        {group.changes.map((change) => (
                          <li key={change} className="flex items-start gap-3 text-sm text-muted-foreground">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            {change}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
