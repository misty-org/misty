import { NavLink } from "react-router";

import { PageHeader, PublicPage } from "@/components/marketing/PublicPage";
import { Button } from "@/components/ui/button";
import { marketingCopy } from "@/content/marketingCopy";
import { BETA_ACCESS_EXTERNAL, BETA_ACCESS_HREF } from "@/lib/site";
import FeatureCard from "./FeatureCard";
import { mainFeatures } from "./featureData";

function BetaAccessButton() {
  return (
    <Button asChild size="lg" className="h-11 px-5">
      {BETA_ACCESS_EXTERNAL ? (
        <a href={BETA_ACCESS_HREF} target="_blank" rel="noopener noreferrer">
          Request beta access
        </a>
      ) : (
        <NavLink to={BETA_ACCESS_HREF}>Request beta access</NavLink>
      )}
    </Button>
  );
}

export default function Features() {
  return (
    <PublicPage>
      <PageHeader
        label="Features"
        title={marketingCopy.features.title}
        description={marketingCopy.features.description}
        action={<BetaAccessButton />}
      />

      <section aria-label="Misty features">
        {mainFeatures.map((feature, index) => (
          <FeatureCard key={feature.id} feature={feature} index={index} />
        ))}
      </section>
    </PublicPage>
  );
}
