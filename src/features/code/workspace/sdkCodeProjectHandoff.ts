/** A temporary native transfer receipt, never a persistent folder permission. */
export interface SdkCodeProjectHandoff {
  root: string;
  ticket: string;
  write: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseSdkCodeProjectHandoff(value: unknown): SdkCodeProjectHandoff {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Code folder handoff.");
  const receipt = value as Record<string, unknown>;
  if (
    Object.keys(receipt).some((key) => !["root", "ticket", "write"].includes(key)) ||
    typeof receipt.root !== "string" ||
    !receipt.root.startsWith("/misty-project/") ||
    !uuid.test(receipt.root.slice("/misty-project/".length)) ||
    typeof receipt.ticket !== "string" ||
    !uuid.test(receipt.ticket) ||
    typeof receipt.write !== "boolean"
  )
    throw new Error("Invalid Code folder handoff.");
  return { root: receipt.root, ticket: receipt.ticket, write: receipt.write };
}
