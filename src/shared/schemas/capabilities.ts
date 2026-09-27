import { z } from "zod";

export const MistyCapabilityNameSchema = z
  .string()
  .max(160)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);

const version = z.number().int().positive().max(2147483647);

const id = z.string().uuid();

const scope = z
  .string()
  .max(160)
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/);

const timestamp = z.iso.datetime({ offset: true });

const unique = <T>(items: T[]) => new Set(items).size === items.length;

/** Schemas are data. Remote references and executable extensions are forbidden. */
export const MistyCapabilityJsonSchema = z.preprocess(
  (value, ctx) => {
    const safe = (item: unknown, depth: number): boolean => {
      if (depth > 32) return false;
      if (!item || typeof item !== "object") return true;
      return Object.entries(item).every(
        ([key, child]) =>
          !["__proto__", "constructor", "prototype"].includes(key) && safe(child, depth + 1),
      );
    };
    if (!safe(value, 0)) {
      ctx.addIssue({ code: "custom", message: "Unsafe or excessively nested schema." });
      return z.NEVER;
    }
    return value;
  },
  z.record(z.string(), z.json()).superRefine((schema, ctx) => {
    const visit = (value: unknown, depth: number): boolean => {
      if (depth > 32) return false;
      if (!value || typeof value !== "object") return true;
      return Object.entries(value).every(([key, child]) => {
        if (["__proto__", "constructor", "prototype", "$dynamicRef"].includes(key)) return false;
        if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#/$defs/")))
          return false;
        return visit(child, depth + 1);
      });
    };
    if (
      new TextEncoder().encode(JSON.stringify(schema)).byteLength > 64 * 1024 ||
      !visit(schema, 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Schema exceeds limits or contains unsafe references.",
      });
  }),
);

export const MistyCapabilityEffectsSchema = z.strictObject({
  kind: z.enum(["read", "write", "send", "execute", "destructive"]),
  incidental: z.array(z.string().min(1).max(300)).max(16).default([]),
  approval: z.enum(["none", "scoped", "interactive"]),
  retry: z.enum(["read_only", "idempotent", "reconcile", "never"]),
});

export const MistyCapabilityDefinitionSchema = z
  .strictObject({
    name: MistyCapabilityNameSchema,
    version,
    description: z.string().min(1).max(2000),
    inputSchema: MistyCapabilityJsonSchema,
    outputSchema: MistyCapabilityJsonSchema,
    requiredScopes: z.array(scope).min(1).max(32).refine(unique, "Duplicate scopes."),
    effects: MistyCapabilityEffectsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.effects.kind !== "read" && value.effects.approval === "none")
      ctx.addIssue({
        code: "custom",
        path: ["effects", "approval"],
        message: "Mutations require scoped or interactive approval.",
      });
    if (value.effects.kind !== "read" && value.effects.retry === "read_only")
      ctx.addIssue({
        code: "custom",
        path: ["effects", "retry"],
        message: "Only reads may use read-only retries.",
      });
  });

export const MistyCapabilityEvidenceSchema = z.strictObject({
  targetId: id,
  observedAt: timestamp,
  kind: z.enum(["resource", "browser", "command", "provider"]),
  reference: z.string().min(1).max(2048),
  revision: z.string().max(200).optional(),
  excerpt: z.string().max(8000).optional(),
});
