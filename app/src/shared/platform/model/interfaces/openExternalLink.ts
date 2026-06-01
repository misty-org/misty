export interface ProviderAuthorizationOpenResult {
  strategy: "misty-browser" | "in-app-browser" | "system-browser" | "window-open";
  platform: string;
  attemptedAt: number;
  fallbackReason?: string;
}
