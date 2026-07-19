import { useState } from "react";
import { HiOutlineChevronDown } from "react-icons/hi2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { changelog } from "./data";

export default function Changelog() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1440px] flex-col overflow-hidden px-5 py-4 sm:px-6 lg:h-screen lg:px-8 xl:px-10">
      <div className="border-b border-border pb-4">
        <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-foreground">
          Changelog
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-6">
        <div className="mx-auto max-w-5xl space-y-3">
        {changelog.map((entry, index) => {
          const isOpen = openIndex === index;
          return (
            <Card
              key={entry.version}
              className="overflow-hidden"
            >
              <Button
                variant="ghost"
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="h-auto w-full justify-between rounded-none px-6 py-4 text-left"
              >
                <div className="flex items-center gap-4">
                  <Badge variant="secondary" className="font-mono text-primary">
                    {entry.version}
                  </Badge>
                  <span className="text-sm font-medium text-foreground">
                    {entry.summary}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {entry.date}
                  </span>
                  <HiOutlineChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </Button>

              {isOpen && (
                <div className="px-6 pb-5 pt-1">
                  <ul className="space-y-2">
                    {entry.changes.map((change, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 text-sm text-muted-foreground"
                      >
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          );
        })}
        </div>
      </div>
    </div>
  );
}
