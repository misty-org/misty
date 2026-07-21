import { ArrowRight, Download as DownloadIcon, ExternalLink, ShieldCheck, Tablet } from "lucide-react";
import { FaApple, FaWindows } from "react-icons/fa";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { currentRelease, type PlatformName, type ReleaseBuild } from "./data";

const platformMeta: Record<
  PlatformName,
  { icon: React.ReactNode; requirements: string }
> = {
  macOS: {
    icon: <FaApple className="size-5" aria-hidden="true" />,
    requirements: "Apple Silicon only",
  },
  Windows: {
    icon: <FaWindows className="size-5" aria-hidden="true" />,
    requirements: "64-bit Windows",
  },
};

function BuildCard({ build }: { build: ReleaseBuild }) {
  const meta = platformMeta[build.platform];

  return (
    <Card className="gap-0 py-0 shadow-sm">
      <CardHeader className="border-b border-border px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground">
              {meta.icon}
            </span>
            <div>
              <h3 className="text-lg font-semibold text-foreground">{build.platform}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{build.architecture}</p>
            </div>
          </div>
          <Badge variant="outline">{build.packageType}</Badge>
        </div>
      </CardHeader>

      <CardContent className="px-6 py-5">
        <dl className="grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Build</dt>
            <dd className="font-medium text-foreground">{currentRelease.version}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Compatibility</dt>
            <dd className="text-right font-medium text-foreground">{meta.requirements}</dd>
          </div>
        </dl>
        <p className="mt-5 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
          ZIP archive · beta software.
        </p>
      </CardContent>

      <CardFooter className="border-t border-border px-6 py-5">
        <Button asChild size="lg" className="h-11 w-full">
          <a href={build.href} aria-label={`Download Misty ${currentRelease.version} for ${build.platform}`}>
            <DownloadIcon aria-hidden="true" />
            Download for {build.platform}
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function Download() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-32 sm:px-8 lg:px-12">
      <header className="mx-auto max-w-3xl text-center">
        <Badge variant="outline" className="mb-5 text-muted-foreground">
          {currentRelease.label} · {currentRelease.version}
        </Badge>
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl md:text-6xl">
          Download Misty for desktop.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
          Public builds are available for Apple Silicon macOS and 64-bit Windows. Shared Space
          services require approved beta access.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="outline">
            <a href={currentRelease.releasePage} target="_blank" rel="noopener noreferrer">
              Release notes
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/waitlist">
              Request beta access
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </header>

      <section aria-labelledby="desktop-builds-title" className="mt-14 md:mt-16">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="desktop-builds-title" className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              Available builds
            </h2>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {currentRelease.builds.map((build) => (
            <BuildCard key={build.platform} build={build} />
          ))}
        </div>
      </section>

      <Separator className="my-12" />

      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]" aria-label="Beta download notes">
        <Alert role="note" className="items-start rounded-xl bg-muted/25 px-5 py-4">
          <ShieldCheck className="mt-0.5 size-4" aria-hidden="true" />
          <AlertTitle>Approved access</AlertTitle>
          <AlertDescription className="leading-6">
            Downloads are public. Shared services require an approved account.
          </AlertDescription>
        </Alert>

        <Alert role="note" className="items-start rounded-xl bg-muted/25 px-5 py-4">
          <Tablet className="mt-0.5 size-4" aria-hidden="true" />
          <AlertTitle>Tablet</AlertTitle>
          <AlertDescription className="leading-6">
            No public tablet build is available yet.
          </AlertDescription>
        </Alert>
      </section>
    </div>
  );
}
