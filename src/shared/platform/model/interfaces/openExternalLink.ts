export interface ProviderAuthorizationOpenResult {
  strategy: "in-app-browser" | "system-browser" | "window-open";
  platform: string;
  attemptedAt: number;
  fallbackReason?: string;
}
