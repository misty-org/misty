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
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1440px] flex-col overflow-hidden px-5 py-4 sm:px-6 lg:h-screen lg:px-8 xl:px-10">
      <div className="border-b border-border pb-4">
        <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-foreground">
          Changelog
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-6">
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
                    <span className="text-sm font-medium text-foreground">
                      {entry.summary}
                    </span>
                  </div>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {entry.date}
                  </span>
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
