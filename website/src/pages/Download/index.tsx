import { useState } from "react";
import { ChevronUp } from "lucide-react";
import { FaApple, FaWindows } from "react-icons/fa";

import { PublicPage } from "@/components/marketing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { currentRelease, type PlatformName, type ReleaseBuild } from "./data";

const platformMeta: Record<PlatformName, { icon: React.ReactNode }> = {
  macOS: { icon: <FaApple className="size-4" aria-hidden="true" /> },
  Windows: { icon: <FaWindows className="size-4" aria-hidden="true" /> },
};

function BuildCard({ build }: { build: ReleaseBuild }) {
  return (
    <Card
      role="article"
      className="gap-0 rounded-xl p-4 shadow-xs ring-1 ring-foreground/10"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-muted-foreground">
            {platformMeta[build.platform].icon}
          </span>
          <h3 className="truncate text-base font-medium text-foreground">
            {build.platform}
          </h3>
        </div>
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {build.packageType}
        </Badge>
      </div>

      <div className="pt-3">
        <p className="text-sm text-muted-foreground">{build.architecture}</p>
      </div>

      <div className="pt-3">
        <Button asChild size="lg" className="h-11 w-full text-sm">
          <a
            href={build.href}
            aria-label={`Download Misty ${currentRelease.version} for ${build.platform}`}
          >
            Download
          </a>
        </Button>
      </div>
    </Card>
  );
}

export default function Download() {
  const [releaseOpen, setReleaseOpen] = useState(true);

  return (
    <PublicPage>
      <header className="pb-8 text-center sm:pb-10">
        <h1 className="text-5xl font-semibold tracking-[-0.04em] text-foreground">
          Download
        </h1>
      </header>

      <section
        aria-labelledby="releases-title"
        className="mx-auto max-w-3xl"
      >
        <div className="flex items-center justify-between gap-5">
          <h2
            id="releases-title"
            className="text-xl font-semibold text-foreground"
          >
            Releases
          </h2>
        </div>

        <Collapsible
          open={releaseOpen}
          onOpenChange={setReleaseOpen}
          className="mt-6"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md py-2 text-left text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>{currentRelease.version} (latest)</span>
              <ChevronUp
                aria-hidden="true"
                className={`size-4 text-muted-foreground transition-transform ${releaseOpen ? "rotate-0" : "rotate-180"}`}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[...currentRelease.builds]
                .sort((a, b) => b.platform.localeCompare(a.platform))
                .map((build) => (
                  <BuildCard key={build.platform} build={build} />
                ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </PublicPage>
  );
}
