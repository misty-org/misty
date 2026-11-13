/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_RELEASE_CHANNEL?: string;
  readonly VITE_DISTRIBUTION_CHANNEL?: string;
  /** Complete API base, including /api or a versioned path such as /api/v2. */
  readonly VITE_MISTY_PUBLIC_API_URL?: string;
  /** Public Misty website origin used for product, download, and roadmap links. */
  readonly VITE_MISTY_PUBLIC_URL?: string;
}
