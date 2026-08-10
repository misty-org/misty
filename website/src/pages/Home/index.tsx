import { marketingCopy } from "@/content/marketingCopy";
import { CapabilityStrip } from "./sections/CapabilityStrip";
import { ClosingCta } from "./sections/ClosingCta";
import { Connections } from "./sections/Connections";
import { FeatureShowcase } from "./sections/FeatureShowcase";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { Updates } from "./sections/Updates";

export default function Home() {
  const copy = marketingCopy.home;

  return (
    <div className="pt-16">
      <Hero copy={copy} />
      <CapabilityStrip proof={copy.proof} />
      <FeatureShowcase features={copy.features} />
      <Connections />
      <HowItWorks copy={copy} />
      <Updates copy={copy} />
      <ClosingCta copy={copy} />
    </div>
  );
}
