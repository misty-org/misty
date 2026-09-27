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
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
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

/** No arbitrary JavaScript, selectors, credentials, or filesystem paths cross this boundary. */
export const MistyBrowserInteractionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fill"),
    elementRef: z.string().min(1).max(128),
    text: z.string().max(64 * 1024),
  }),
  z.strictObject({
    kind: z.literal("select"),
    elementRef: z.string().min(1).max(128),
    values: z.array(z.string().max(1000)).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("scroll"),
    elementRef: z.string().min(1).max(128).optional(),
    x: z.number().int().min(-4000).max(4000),
    y: z.number().int().min(-4000).max(4000),
  }),
  z.strictObject({
    kind: z.literal("point"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  z.strictObject({
    kind: z.literal("key"),
    elementRef: z.string().min(1).max(128),
    key: z.enum([
      "Enter",
      "Escape",
      "Tab",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ]),
  }),
]);
