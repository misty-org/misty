import { z } from "zod";
import { MistyContractError } from "./server.js";
const text = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !value.includes("\0"));
const dimension = z.number().int().min(2).max(65535);
const pixels = z.number().int().min(0).max(65535);
export const MistySSHConnectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("configured"), id: text(256) }),
  z.strictObject({
    kind: z.literal("direct"),
    host: text(253),
    user: text(128).optional(),
    port: z.number().int().min(1).max(65535),
  }),
]);
export const MistyTerminalSizeSchema = z.strictObject({
  cols: dimension,
  rows: dimension,
  pixelWidth: pixels.optional(),
  pixelHeight: pixels.optional(),
});
export const MistyTerminalCreateSchema =
  MistyTerminalSizeSchema.partial().extend({
    cwd: text(4096).optional(),
    env: z
      .record(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
        z
          .string()
          .max(32768)
          .refine((value) => !value.includes("\0")),
      )
      .refine((value) => Object.keys(value).length <= 128)
      .optional(),
    environment: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("local") }),
        z.strictObject({
          kind: z.literal("ssh"),
          connection: MistySSHConnectionSchema,
        }),
      ])
      .optional(),
  });
export const MistyTerminalSessionSchema = z.strictObject({ handle: text(256) });
export const MistyTerminalEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("output"), data: z.string() }),
  z.strictObject({
    type: z.literal("exit"),
    exitCode: z.number().int().nullable(),
  }),
]);
export const MistySSHEnvironmentSchema = z.object({
  id: z.string(),
  label: z.string(),
  host: z.string(),
  user: z.string().nullable().optional(),
  port: z.number().int().min(1).max(65535),
  deviceLocal: z.boolean(),
  agentTools: z.string(),
});
export const MistySSHHostKeyStatusSchema = z.object({
  state: z.string(),
  fingerprints: z.array(z.string()),
  message: z.string(),
});
const emptyResult = z
  .union([z.undefined(), z.null()])
  .transform(() => undefined);
const contract = <P extends z.ZodType, R extends z.ZodType>(
  params: P,
  result: R,
) => ({
  capability: "terminal.execute" as const,
  platforms: ["macos"] as const,
  params,
  result,
});
export const mistyTerminalContracts = {
  "terminal.create": contract(
    MistyTerminalCreateSchema,
    MistyTerminalSessionSchema,
  ),
  "terminal.write": contract(
    z.strictObject({ handle: text(256), data: z.string().max(1024 * 1024) }),
    emptyResult,
  ),
  "terminal.resize": contract(
    MistyTerminalSizeSchema.extend({ handle: text(256) }),
    emptyResult,
  ),
  "terminal.close": contract(MistyTerminalSessionSchema, emptyResult),
  "terminal.environments": contract(
    z.strictObject({}),
    z.array(MistySSHEnvironmentSchema),
  ),
  "terminal.preflight": contract(
    z.strictObject({ connection: MistySSHConnectionSchema }),
    MistySSHHostKeyStatusSchema,
  ),
  "terminal.trustHost": contract(
    z.strictObject({
      connection: MistySSHConnectionSchema,
      fingerprint: text(256),
    }),
    MistySSHHostKeyStatusSchema,
  ),
} as const;
export type MistyTerminalMethod = keyof typeof mistyTerminalContracts;
export type MistyTerminalParams<M extends MistyTerminalMethod> = z.input<
  (typeof mistyTerminalContracts)[M]["params"]
>;
export type MistyTerminalResult<M extends MistyTerminalMethod> = z.output<
  (typeof mistyTerminalContracts)[M]["result"]
>;
export type MistySSHConnection = z.input<typeof MistySSHConnectionSchema>;
export type MistyTerminalSize = z.input<typeof MistyTerminalSizeSchema>;
export type MistyTerminalCreate = z.input<typeof MistyTerminalCreateSchema>;
export type MistyTerminalSession = Readonly<
  z.output<typeof MistyTerminalSessionSchema>
>;
export type MistyTerminalEvent = z.output<typeof MistyTerminalEventSchema>;
export type MistySSHEnvironment = z.output<typeof MistySSHEnvironmentSchema>;
export type MistySSHHostKeyStatus = z.output<
  typeof MistySSHHostKeyStatusSchema
>;
export function isMistyTerminalMethod(
  method: string,
): method is MistyTerminalMethod {
  return Object.prototype.hasOwnProperty.call(mistyTerminalContracts, method);
}
export function parseTerminalParams<M extends MistyTerminalMethod>(
  method: M,
  input: unknown,
): MistyTerminalParams<M> {
  if (!isMistyTerminalMethod(method))
    throw new MistyContractError(
      "unsupported_method",
      "Unknown terminal method.",
    );
  const parsed = mistyTerminalContracts[method].params.safeParse(input ?? {});
  if (!parsed.success)
    throw new MistyContractError(
      "invalid_params",
      `Invalid parameters for ${method}.`,
    );
  return parsed.data as MistyTerminalParams<M>;
}
export function parseTerminalResult<M extends MistyTerminalMethod>(
  method: M,
  input: unknown,
): MistyTerminalResult<M> {
  if (!isMistyTerminalMethod(method))
    throw new MistyContractError(
      "unsupported_method",
      "Unknown terminal method.",
    );
  const parsed = mistyTerminalContracts[method].result.safeParse(input);
  if (!parsed.success)
    throw new MistyContractError(
      "invalid_response",
      `Invalid response for ${method}.`,
    );
  return parsed.data as MistyTerminalResult<M>;
}
