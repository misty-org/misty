export interface ProviderAuthorizationOpenResult {
  strategy: "misty-browser" | "window-open";
  platform: string;
  attemptedAt: number;
  fallbackReason?: string;
}
