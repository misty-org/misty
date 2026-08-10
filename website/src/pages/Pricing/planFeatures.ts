import { plans } from "./data";

export interface PlanFeatureList {
  inheritsFrom?: string;
  features: readonly string[];
}

/**
 * Keep each tier's published features explicit so every card communicates its
 * own limits without relying on implied inheritance.
 */
export function planFeatureList(index: number): PlanFeatureList {
  return { features: plans[index].features };
}
