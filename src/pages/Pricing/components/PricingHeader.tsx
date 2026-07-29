import { marketingCopy } from "@/content/marketingCopy";

export default function PricingHeader() {
  return (
    <header className="mx-auto max-w-3xl text-center">
      <h1 className="text-balance text-3xl font-medium tracking-[-0.035em] text-foreground sm:text-4xl">
        {marketingCopy.pricing.title}
      </h1>
      <p className="mt-4 text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
        {marketingCopy.pricing.description}
      </p>
    </header>
  );
}
