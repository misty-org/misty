import { ArrowRight } from "lucide-react";
import { NavLink } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BETA_ACCESS_EXTERNAL, BETA_ACCESS_HREF } from "@/lib/site";
import FeatureCard from "./FeatureCard";
import { mainFeatures } from "./featureData";

function BetaAccessButton() {
  return (
    <Button asChild size="lg" className="h-11 px-5">
      {BETA_ACCESS_EXTERNAL ? (
        <a href={BETA_ACCESS_HREF} target="_blank" rel="noopener noreferrer">
          Request beta access
          <ArrowRight aria-hidden="true" />
        </a>
      ) : (
        <NavLink to={BETA_ACCESS_HREF}>
          Request beta access
          <ArrowRight aria-hidden="true" />
        </NavLink>
      )}
    </Button>
  );
}

export default function Features() {
  return (
    <div className="mx-auto flex max-w-[1420px] flex-col px-5 pb-20 pt-32 sm:px-8 md:px-12 lg:px-20">
      <header className="grid gap-8 border-b border-border pb-12 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end lg:gap-16 lg:pb-16">
        <div className="max-w-4xl">
          <Badge variant="outline" className="mb-5 text-muted-foreground">
            Invite-only beta
          </Badge>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl md:text-6xl">
            Features
          </h1>
          <p className="mt-5 max-w-3xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Each Space includes Members, Chat, Tasks, and a shared Library. Files stay private
            until you add them.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <BetaAccessButton />
          <Button asChild size="lg" variant="outline" className="h-11 px-5">
            <NavLink to="/download">Download beta</NavLink>
          </Button>
        </div>
      </header>

      <section aria-label="Misty features" className="flex flex-col gap-6 py-12 md:gap-8 md:py-16">
        {mainFeatures.map((feature, index) => (
          <FeatureCard key={feature.id} feature={feature} index={index} />
        ))}
      </section>

      <section className="flex flex-col gap-5 border-t border-border py-12 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          Request beta access.
        </h2>
        <BetaAccessButton />
      </section>
    </div>
  );
}
