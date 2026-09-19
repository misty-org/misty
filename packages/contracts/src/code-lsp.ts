import { z } from "zod";

export const MISTY_LSP_MAX_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const handle = z.string().min(1).max(256);
export const MistyLspPayloadSchema = z
  .string()
  .max(MISTY_LSP_MAX_BYTES)
  .refine((payload) => {
    if (encoder.encode(payload).byteLength > MISTY_LSP_MAX_BYTES) return false;
    try {
      const value = JSON.parse(payload);
      return value !== null && !Array.isArray(value) && value.jsonrpc === "2.0";
    } catch {
      return false;
    }
  }, "Expected a bounded JSON-RPC 2.0 language-server message.");
export const MistyLspLanguageSchema = z.enum([
  "typescript",
  "javascript",
  "rust",
  "python",
  "go",
  "cpp",
  "c",
  "yaml",
  "json",
  "html",
  "css",
  "bash",
  "lua",
  "zig",
  "tailwind",
]);
const session = z.strictObject({ handle });
export const MistyLspEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("message"),
    payload: MistyLspPayloadSchema,
  }),
  z.strictObject({ type: z.literal("exit"), reason: z.string().max(1024) }),
]);
const empty = z.union([z.null(), z.undefined()]).transform(() => undefined);
const contract = <P extends z.ZodType, R extends z.ZodType>(
  params: P,
  result: R,
) => ({
  capability: "code.execute" as const,
  platforms: ["macos"] as const,
  params,
  result,
});
export const mistyCodeLspContracts = {
  "code.lsp.start": contract(
    z.strictObject({
      language: MistyLspLanguageSchema,
      // An explicit local-process capability, like terminal.execute. This is not a
      // sandboxed files handle: the configured language server can access this computer.
      cwd: z
        .string()
        .min(1)
        .max(4096)
        .refine((path) => path.startsWith("/") && !path.includes("\0")),
    }),
    session,
  ),
  "code.lsp.send": contract(
    z.strictObject({ handle, payload: MistyLspPayloadSchema }),
    empty,
  ),
  "code.lsp.stop": contract(session, empty),
} as const;
export type MistyLspLanguage = z.infer<typeof MistyLspLanguageSchema>;
export type MistyLspEvent = z.infer<typeof MistyLspEventSchema>;
export function isMistyCodeLspMethod(
  method: string,
): method is keyof typeof mistyCodeLspContracts {
  return Object.prototype.hasOwnProperty.call(mistyCodeLspContracts, method);
}
