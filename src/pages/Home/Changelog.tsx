import { changelog } from "../Changelog/data";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

export default function Changelog() {
  return (
    <div>
      <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
        Changelog
      </h2>

      <Accordion type="single" defaultValue="entry-0" collapsible className="gap-3">
        {changelog.map((entry, index) => (
          <AccordionItem
            key={entry.version}
            value={`entry-${index}`}
            className="overflow-hidden rounded-xl border bg-card px-6 shadow-xs"
          >
            <AccordionTrigger className="items-center gap-4 hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center gap-4">
                <Badge variant="secondary" className="shrink-0 font-mono">
                  {entry.version}
                </Badge>
                <span className="truncate font-medium text-foreground">
                  {entry.summary}
                </span>
              </span>
              <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
                {entry.date}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-2">
                {entry.groups
                  .flatMap((group) => group.changes)
                  .slice(0, 5)
                  .map((change) => (
                    <li
                      key={change}
                      className="flex items-start gap-3 text-sm text-muted-foreground"
                    >
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      {change}
                    </li>
                  ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <p className="mt-6 text-sm text-muted-foreground">
        <a
          href="https://forms.gle/your-form-id"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          See recent updates and changes to Misty &rarr;
        </a>
      </p>
    </div>
  );
}
