import type { TelemetryIdentityUser } from "@/models/interfaces/analytics/identity";
export type { TelemetryIdentityUser } from "@/models/interfaces/analytics/identity";
import type { TelemetryClient } from "@/models/interfaces/analytics/types";

export class TelemetryIdentityManager {
  private currentUserId: string | null = null;
  constructor(private readonly client: TelemetryClient) {}

  sync(user: TelemetryIdentityUser | null): void {
    if (!user) {
      if (this.currentUserId) this.client.resetIdentity();
      this.currentUserId = null;
      return;
    }
    if (this.currentUserId === user.id) return;
    this.client.identify(user.id, {
      ...(user.accountCreatedAt ? { account_created_at: user.accountCreatedAt } : {}),
      ...(user.currentPlan ? { current_plan: user.currentPlan } : {}),
    });
    this.currentUserId = user.id;
  }
}
