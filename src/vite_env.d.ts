/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_RELEASE_CHANNEL?: string;
  readonly VITE_DISTRIBUTION_CHANNEL?: string;
  readonly VITE_MISTY_PUBLIC_API_URL?: string;
  readonly VITE_MISTY_PUBLIC_URL?: string;
}
