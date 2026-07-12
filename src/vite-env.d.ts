/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_RELEASE_CHANNEL?: string;
  readonly VITE_DISTRIBUTION_CHANNEL?: string;
}
