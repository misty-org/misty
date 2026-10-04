import { z } from "zod";
import { mistyBrowserProviders } from "./browser-providers.ts";

export const MistyBrowserUrlSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => {
    if (value === "about:blank") return true;
    try {
      const url = new URL(value);
      return (
        ["https:", "http:", "webkit-extension:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Browser views support HTTP, HTTPS and about:blank URLs.");

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
