import { z } from "zod";
import { mistyBrowserProviders } from "./browser-providers.ts";

/** A provider account is an app-local identity, never a cookie or an API token. */
export const MistyBrowserProviderSchema = z.strictObject({
  id: z.enum(
    Object.keys(mistyBrowserProviders) as [
      keyof typeof mistyBrowserProviders,
      ...(keyof typeof mistyBrowserProviders)[],
    ],
  ),
  accountId: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-zA-Z0-9_-]+$/),
});

export type MistyBrowserProvider = z.infer<typeof MistyBrowserProviderSchema>;
