import type { TelemetryClient } from "./types";

export interface TelemetryIdentityUser {
  id: string;
  accountCreatedAt?: string;
  currentPlan?: string;
}

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
