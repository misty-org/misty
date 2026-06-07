import { marketingCopy } from "@/content/marketingCopy";
import { ClosingCta } from "./sections/ClosingCta";
import { EcosystemStrip } from "./sections/EcosystemStrip";
import { FeatureShowcase } from "./sections/FeatureShowcase";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { ResourcePreview } from "./sections/ResourcePreview";

export default function Home() {
  const copy = marketingCopy.home;

  return (
    <div>
      <Hero copy={copy} />
      <div className="home-content-rail">
        <EcosystemStrip />
        <HowItWorks />
        <FeatureShowcase />
        <ResourcePreview />
        <ClosingCta copy={copy} />
      </div>
    </div>
  );
}
