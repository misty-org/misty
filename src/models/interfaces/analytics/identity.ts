import type { TelemetryClient } from "@/models/interfaces/analytics/types";

export interface TelemetryIdentityUser {
  id: string;
  accountCreatedAt?: string;
  currentPlan?: string;
}
