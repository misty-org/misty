import { PageHeader } from "@/components/marketing/PublicPage";
import { marketingCopy } from "@/content/marketingCopy";

export default function PricingHeader() {
  return (
    <PageHeader
      label="Pricing"
      title={marketingCopy.pricing.title}
      description={marketingCopy.pricing.description}
    />
  );
}
