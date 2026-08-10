import { NavLink } from "react-router";

import { PageHeader, PublicPage } from "@/components/marketing";
import { Button } from "@/components/ui/button";
import { marketingCopy } from "@/content/marketingCopy";
import { JOIN_HREF } from "@/lib/site";
import FeatureCard from "./FeatureCard";
import { mainFeatures } from "./featureData";

function JoinNowButton() {
  return (
    <Button asChild size="lg" className="h-11 px-5">
      <NavLink to={JOIN_HREF}>Join now</NavLink>
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
        action={<JoinNowButton />}
      />

      <section aria-label="Misty features">
        {mainFeatures.map((feature, index) => (
          <FeatureCard key={feature.id} feature={feature} index={index} />
        ))}
      </section>
    </PublicPage>
  );
}
