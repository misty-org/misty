/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_RELEASE_CHANNEL?: string;
  readonly VITE_DISTRIBUTION_CHANNEL?: string;
  readonly VITE_MISTY_DEMO_MODE?: string;
  readonly VITE_MISTY_DEMO_SESSION_TOKEN?: string;
  readonly VITE_MISTY_DEMO_ACCOUNT?: string;
  /** Complete API base, including /api or a versioned path such as /api/v2. */
  readonly VITE_MISTY_PUBLIC_API_URL?: string;
  /** Legacy alias; accepts the same complete API-base semantics. */
  readonly VITE_MISTY_SERVER_URL?: string;
  /** Legacy alias; accepts the same complete API-base semantics. */
  readonly VITE_API_BASE?: string;
  readonly VITE_PRIVACY_POLICY_URL?: string;
  readonly VITE_TERMS_URL?: string;
  readonly VITE_DESKTOP_LICENSE_URL?: string;
  readonly VITE_SUPPORT_URL?: string;
  readonly VITE_SECURITY_URL?: string;
}
