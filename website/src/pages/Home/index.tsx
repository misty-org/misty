import { marketingCopy } from "@/content/marketingCopy";
import { ClosingCta } from "./sections/ClosingCta";
import { FeatureShowcase } from "./sections/FeatureShowcase";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { Integrations } from "./sections/Integrations";
import { ResourcePreview } from "./sections/ResourcePreview";

export default function Home() {
  const copy = marketingCopy.home;

  return (
    <div className="pt-14 sm:pt-16">
      <Hero copy={copy} />
      <FeatureShowcase />
      <HowItWorks />
      <Integrations />
      <ResourcePreview />
      <ClosingCta copy={copy} />
    </div>
  );
}
