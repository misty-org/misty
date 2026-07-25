import { plans } from "./data";

export interface PlanFeatureList {
  /** Name of the tier directly below, when this plan is a strict superset. */
  inheritsFrom?: string;
  /** Only what this plan adds on top of that tier. */
  features: readonly string[];
}

/**
 * Each tier is a superset of the one below, so a card leads with a single
 * "Everything in <tier>" row rather than repeating rows the reader already
 * scanned. The plan data keeps every feature — only the display is deduped.
 */
export function planFeatureList(index: number): PlanFeatureList {
  const plan = plans[index];
  const previous = index > 0 ? plans[index - 1] : undefined;

  if (!previous) return { features: plan.features };

  const inherited = new Set<string>(previous.features);
  return {
    inheritsFrom: previous.name,
    features: plan.features.filter((feature) => !inherited.has(feature)),
  };
}
